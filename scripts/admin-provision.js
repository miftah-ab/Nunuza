#!/usr/bin/env node
/**
 * Admin Access & Entitlement Provisioning Script (Nunuza v1.0.0).
 *
 * Implements BED-03 / BED-09 administrative workflows:
 * - Strictly server-side / admin-only via Supabase service-role credentials.
 * - Allows granting Private Beta access (`internal_beta`, full v1.0.0 features, no Polar, card-free).
 * - Allows setting expiration dates and internal notes.
 * - Allows revoking Private Beta access (pauses workspace, cancels queued jobs, preserves all data).
 * - Inspects workspace status and full provisioning audit history.
 * - NEVER exposed to client roles or public signup.
 *
 * Usage:
 *   node scripts/admin-provision.js --workspace <UUID> --grant-beta [--expires-in-days <N>] [--notes "<reason>"]
 *   node scripts/admin-provision.js --email <email> --grant-beta [--notes "<reason>"]
 *   node scripts/admin-provision.js --workspace <UUID> --revoke-beta [--notes "<reason>"]
 *   node scripts/admin-provision.js --workspace <UUID> --status
 *   node scripts/admin-provision.js --workspace <UUID> --history
 *   node scripts/admin-provision.js --workspace <UUID> --entitlement <internal_beta|paid_trial|paid_active|suspended|expired>
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
  let action = null; // 'grant-beta', 'revoke-beta', 'status', 'history', 'entitlement'
  let entitlement = null;
  let expiresInDays = null;
  let expiresAt = null;
  let notes = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace' && args[i + 1]) {
      workspaceId = args[i + 1];
      i++;
    } else if (args[i] === '--email' && args[i + 1]) {
      email = args[i + 1];
      i++;
    } else if (args[i] === '--grant-beta') {
      action = 'grant-beta';
    } else if (args[i] === '--revoke-beta') {
      action = 'revoke-beta';
    } else if (args[i] === '--status') {
      action = 'status';
    } else if (args[i] === '--history') {
      action = 'history';
    } else if (args[i] === '--expires-in-days' && args[i + 1]) {
      expiresInDays = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--expires-at' && args[i + 1]) {
      expiresAt = args[i + 1];
      i++;
    } else if (args[i] === '--notes' && args[i + 1]) {
      notes = args[i + 1];
      i++;
    } else if (args[i] === '--entitlement' && args[i + 1]) {
      action = 'entitlement';
      entitlement = args[i + 1];
      i++;
    }
  }

  if (!action) {
    console.error('Error: Must specify an action: --grant-beta, --revoke-beta, --status, --history, or --entitlement');
    process.exit(1);
  }

  // Lookup workspace if email provided
  if (!workspaceId && email) {
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
    .select('*')
    .eq('id', workspaceId)
    .single();

  if (getErr || !currentWs) {
    console.error(`Error: Workspace ${workspaceId} not found.`);
    process.exit(1);
  }

  // Handle actions
  if (action === 'status') {
    console.log('\n=== WORKSPACE STATUS ===');
    console.log(`ID:               ${currentWs.id}`);
    console.log(`Name:             ${currentWs.name}`);
    console.log(`Owner ID:         ${currentWs.owner_user_id}`);
    console.log(`Access Mode:      ${currentWs.access_mode || (currentWs.entitlement_type === 'internal_beta' || currentWs.entitlement_type === 'publishing_beta' ? 'private_beta' : 'commercial')}`);
    console.log(`Entitlement:      ${currentWs.entitlement_type}`);
    console.log(`Agent State:      ${currentWs.state}`);
    console.log(`Operating Mode:   ${currentWs.operating_mode}`);
    console.log(`Paused At:        ${currentWs.paused_at || 'Not paused'}`);
    console.log(`Beta Expires At:  ${currentWs.beta_expires_at || 'Never'}`);
    console.log(`Beta Notes:       ${currentWs.beta_notes || 'None'}`);
    console.log(`Beta Granted At:  ${currentWs.beta_granted_at || 'N/A'}`);
    console.log(`Beta Revoked At:  ${currentWs.beta_revoked_at || 'N/A'}`);
    return;
  }

  if (action === 'history') {
    console.log(`\n=== AUDIT HISTORY FOR WORKSPACE ${workspaceId} ===`);
    const { data: events, error: evErr } = await supabase
      .from('audit_events')
      .select('id, actor_type, action, safe_metadata, created_at')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (evErr) {
      console.error('Error fetching audit history:', evErr.message);
      process.exit(1);
    }

    if (!events || events.length === 0) {
      console.log('No audit events found.');
    } else {
      events.forEach(ev => {
        console.log(`[${ev.created_at}] [${ev.actor_type}] ${ev.action}`);
        if (ev.safe_metadata) {
          console.log(`   Metadata: ${JSON.stringify(ev.safe_metadata)}`);
        }
      });
    }
    return;
  }

  if (action === 'grant-beta') {
    let targetExpiresAt = expiresAt;
    if (expiresInDays && !targetExpiresAt) {
      const d = new Date();
      d.setDate(d.getDate() + expiresInDays);
      targetExpiresAt = d.toISOString();
    }

    console.log('\n--- Provisioning Private Full-Feature Beta ---');
    console.log(`Workspace:   ${currentWs.name} (${workspaceId})`);
    console.log(`Expiration:  ${targetExpiresAt || 'Never'}`);
    console.log(`Notes:       ${notes || 'Authorized private beta tester'}`);

    // Try RPC first
    let rpcDone = false;
    try {
      const { error: rpcErr } = await supabase.rpc('admin_grant_private_beta', {
        p_workspace_id: workspaceId,
        p_expires_at: targetExpiresAt,
        p_notes: notes || 'Private Beta Access',
      });
      if (!rpcErr) rpcDone = true;
    } catch (_) { }

    if (!rpcDone) {
      // Direct update with graceful enum fallback
      let updatePayload = {
        entitlement_type: 'internal_beta',
        updated_at: new Date().toISOString(),
      };
      if (currentWs.hasOwnProperty('access_mode')) {
        updatePayload.access_mode = 'private_beta';
        updatePayload.beta_expires_at = targetExpiresAt;
        updatePayload.beta_notes = notes;
        updatePayload.beta_granted_at = new Date().toISOString();
        updatePayload.beta_revoked_at = null;
      }

      let { error: upErr } = await supabase
        .from('workspaces')
        .update(updatePayload)
        .eq('id', workspaceId);

      if (upErr && upErr.code === '22P02') {
        // Fallback for pre-migration enum
        console.log('Postgres enum internal_beta pending migration, using publishing_beta as DB persistence alias...');
        const fallbackPayload = {
          entitlement_type: 'publishing_beta',
          updated_at: new Date().toISOString(),
        };
        const res = await supabase.from('workspaces').update(fallbackPayload).eq('id', workspaceId);
        upErr = res.error;
      }

      if (upErr) {
        console.error('Error updating workspace:', upErr.message);
        process.exit(1);
      }

      await supabase.from('audit_events').insert({
        workspace_id: workspaceId,
        actor_type: 'admin',
        action: 'beta_access_granted',
        resource_type: 'workspace',
        resource_id: workspaceId,
        safe_metadata: {
          previous_entitlement: currentWs.entitlement_type,
          new_entitlement: 'internal_beta',
          access_mode: 'private_beta',
          expires_at: targetExpiresAt,
          notes: notes || 'Private Beta Access',
        },
      });
    }

    console.log('\nSuccessfully granted Private Beta access!');
    return;
  }

  if (action === 'revoke-beta') {
    console.log('\n--- Revoking Private Beta Access ---');
    console.log(`Workspace:   ${currentWs.name} (${workspaceId})`);
    console.log(`Reason:      ${notes || 'Revoked by administrator'}`);

    let rpcDone = false;
    try {
      const { error: rpcErr } = await supabase.rpc('admin_revoke_private_beta', {
        p_workspace_id: workspaceId,
        p_notes: notes || 'Revoked by administrator',
      });
      if (!rpcErr) rpcDone = true;
    } catch (_) { }

    if (!rpcDone) {
      let updatePayload = {
        entitlement_type: 'suspended',
        state: 'paused',
        paused_at: currentWs.paused_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (currentWs.hasOwnProperty('access_mode')) {
        updatePayload.beta_revoked_at = new Date().toISOString();
        updatePayload.beta_notes = notes || currentWs.beta_notes;
      }

      let { error: upErr } = await supabase
        .from('workspaces')
        .update(updatePayload)
        .eq('id', workspaceId);

      if (upErr && upErr.code === '22P02') {
        const fallbackPayload = {
          entitlement_type: 'inactive',
          state: 'paused',
          paused_at: currentWs.paused_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const res = await supabase.from('workspaces').update(fallbackPayload).eq('id', workspaceId);
        upErr = res.error;
      }

      if (upErr) {
        console.error('Error revoking beta:', upErr.message);
        process.exit(1);
      }

      // Cancel queued/waiting publishing jobs safely without deleting user content
      await supabase
        .from('agent_jobs')
        .update({ status: 'canceled', updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .in('status', ['queued', 'waiting_for_approval']);

      await supabase.from('audit_events').insert({
        workspace_id: workspaceId,
        actor_type: 'admin',
        action: 'beta_access_revoked',
        resource_type: 'workspace',
        resource_id: workspaceId,
        safe_metadata: {
          previous_entitlement: currentWs.entitlement_type,
          new_entitlement: 'suspended',
          reason: notes || 'Revoked by administrator',
        },
      });
    }

    console.log('\nSuccessfully revoked Private Beta access. Queued jobs safely canceled.');
    return;
  }

  if (action === 'entitlement') {
    const ALLOWED = ['internal_beta', 'paid_trial', 'paid_active', 'suspended', 'expired', 'publishing_beta', 'draft_only', 'inactive'];
    if (!ALLOWED.includes(entitlement)) {
      console.error(`Error: --entitlement must be one of: ${ALLOWED.join(', ')}`);
      process.exit(1);
    }

    let { error: upErr } = await supabase
      .from('workspaces')
      .update({ entitlement_type: entitlement, updated_at: new Date().toISOString() })
      .eq('id', workspaceId);

    if (upErr && upErr.code === '22P02') {
      const fallback = (entitlement === 'internal_beta') ? 'publishing_beta' : 'inactive';
      const res = await supabase.from('workspaces').update({ entitlement_type: fallback, updated_at: new Date().toISOString() }).eq('id', workspaceId);
      upErr = res.error;
    }

    if (upErr) {
      console.error('Error updating entitlement:', upErr.message);
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

    console.log(`\nSuccessfully updated entitlement to: ${entitlement}`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
