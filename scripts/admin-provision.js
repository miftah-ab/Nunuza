#!/usr/bin/env node
/**
 * Admin Entitlement Provisioning Script.
 *
 * Implements BED-03 / BED-09 administrative provisioning:
 * - Strictly server-side / admin-only via Supabase service-role credentials.
 * - Allows explicit promotion of a workspace to `internal_test` or `publishing_beta`.
 * - Allows demotion back to `draft_only`.
 * - Records audit event in `audit_events`.
 * - NEVER exposed to client roles or public signup.
 *
 * Usage:
 *   node scripts/admin-provision.js --workspace <UUID> --entitlement <publishing_beta|internal_test|draft_only>
 *   node scripts/admin-provision.js --email <user_email> --entitlement <publishing_beta|internal_test|draft_only>
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Read environment
let envFile = '';
if (fs.existsSync('.env.local')) {
  envFile = fs.readFileSync('.env.local', 'utf8');
} else if (fs.existsSync('.env.pro')) {
  envFile = fs.readFileSync('.env.pro', 'utf8');
} else {
  console.error('Error: Neither .env.local nor .env.pro found.');
  process.exit(1);
}

const env = {};
envFile.split('\n').forEach(line => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
});

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const args = process.argv.slice(2);
  let workspaceId = null;
  let email = null;
  let entitlement = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && args[i + 1]) {
      workspaceId = args[i + 1];
      i++;
    } else if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (args[i] === '--entitlement' && args[i + 1]) {
      entitlement = args[i + 1];
      i++;
    }
  }

  const ALLOWED_ENTITLEMENTS = ['draft_only', 'internal_test', 'publishing_beta'];
  if (!entitlement || !ALLOWED_ENTITLEMENTS.includes(entitlement)) {
    console.error(`Error: --entitlement must be one of: ${ALLOWED_ENTITLEMENTS.join(', ')}`);
    console.log('Usage: node scripts/admin-provision.js --workspace <UUID> --entitlement <type>');
    process.exit(1);
  }

  // Lookup workspace if email provided
  if (!workspaceId && email) {
    // Find user by email in auth.users
    const { data: usersData, error: userErr } = await supabase.auth.admin.listUsers();
    if (userErr) {
      console.error('Error listing users:', userErr.message);
      process.exit(1);
    }
    const user = usersData.users.find(u => u.email === email);
    if (!user) {
      console.error(`Error: No user found with email: ${email}`);
      process.exit(1);
    }
    const { data: ws, error: wsErr } = await supabase
      .from('workspaces')
      .select('id, name, entitlement_type')
      .eq('owner_user_id', user.id)
      .single();
    if (wsErr || !ws) {
      console.error(`Error: No workspace found for user: ${email}`);
      process.exit(1);
    }
    workspaceId = ws.id;
    console.log(`Found workspace for ${email}: ${ws.name} (${ws.id}) [Current: ${ws.entitlement_type}]`);
  }

  if (!workspaceId) {
    console.error('Error: Must specify either --workspace <UUID> or --email <email>');
    process.exit(1);
  }

  // Verify workspace exists
  const { data: currentWs, error: getErr } = await supabase
    .from('workspaces')
    .select('id, name, entitlement_type, owner_user_id')
    .eq('id', workspaceId)
    .single();

  if (getErr || !currentWs) {
    console.error(`Error: Workspace ${workspaceId} not found.`);
    process.exit(1);
  }

  console.log(`\n--- Provisioning Workspace ---`);
  console.log(`Workspace ID:    ${currentWs.id}`);
  console.log(`Workspace Name:  ${currentWs.name}`);
  console.log(`Old Entitlement: ${currentWs.entitlement_type}`);
  console.log(`New Entitlement: ${entitlement}`);

  // Use the admin RPC functions if available, or direct service_role update
  let rpcSuccess = false;
  if (entitlement === 'publishing_beta') {
    const { error: rpcErr } = await supabase.rpc('admin_provision_publishing_beta', {
      p_workspace_id: workspaceId,
    });
    if (!rpcErr) rpcSuccess = true;
    else console.warn('RPC admin_provision_publishing_beta failed, falling back to direct update:', rpcErr.message);
  } else if (entitlement === 'internal_test') {
    const { error: rpcErr } = await supabase.rpc('admin_provision_internal_test', {
      p_workspace_id: workspaceId,
    });
    if (!rpcErr) rpcSuccess = true;
    else console.warn('RPC admin_provision_internal_test failed, falling back to direct update:', rpcErr.message);
  } else if (entitlement === 'draft_only' && currentWs.entitlement_type === 'internal_test') {
    const { error: rpcErr } = await supabase.rpc('admin_revoke_internal_test', {
      p_workspace_id: workspaceId,
    });
    if (!rpcErr) rpcSuccess = true;
  }

  if (!rpcSuccess) {
    // Direct service_role update + audit logging
    const { error: updateErr } = await supabase
      .from('workspaces')
      .update({ entitlement_type: entitlement, updated_at: new Date().toISOString() })
      .eq('id', workspaceId);

    if (updateErr) {
      console.error('Error updating workspace:', updateErr.message);
      process.exit(1);
    }

    await supabase.from('audit_events').insert({
      workspace_id: workspaceId,
      actor_type: 'admin',
      action: 'entitlement_changed',
      resource_type: 'workspace',
      resource_id: workspaceId,
      safe_metadata: {
        previous_entitlement: currentWs.entitlement_type,
        new_entitlement: entitlement,
        via: 'admin_provision_script',
      },
    });
  }

  // Verify updated state
  const { data: updatedWs } = await supabase
    .from('workspaces')
    .select('id, name, entitlement_type, state, operating_mode')
    .eq('id', workspaceId)
    .single();

  console.log(`\nSuccessfully updated!`);
  console.log(JSON.stringify(updatedWs, null, 2));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

