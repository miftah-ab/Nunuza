const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envFile = fs.readFileSync('.env.local', 'utf8');
const env = {};
envFile.split('\n').forEach(line => {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim().replace(/^['"]|['"]$/g, '');
});

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const userId = '28c4d2a1-0054-4b88-88b8-138aef664320';
  
  // 1. Check or insert profile
  const { data: existingProfile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (!existingProfile) {
    console.log('Inserting profile for', userId);
    const { error: insPErr } = await supabase.from('profiles').insert({
      id: userId,
      display_name: 'fuhdjj7',
      timezone: 'UTC'
    });
    if (insPErr) console.error('Profile insert error:', insPErr);
    else console.log('Profile inserted successfully.');
  } else {
    console.log('Profile already exists:', existingProfile);
  }

  // 2. Check or insert workspace
  const { data: existingWorkspace } = await supabase
    .from('workspaces')
    .select('*')
    .eq('owner_user_id', userId)
    .single();

  if (!existingWorkspace) {
    console.log('Inserting workspace for', userId);
    const { data: ws, error: insWErr } = await supabase.from('workspaces').insert({
      owner_user_id: userId,
      name: "fuhdjj7's Workspace",
      state: 'setup_required',
      entitlement_type: 'draft_only',
      operating_mode: 'approval_required'
    }).select().single();
    if (insWErr) console.error('Workspace insert error:', insWErr);
    else console.log('Workspace inserted successfully:', ws);
  } else {
    console.log('Workspace already exists:', existingWorkspace);
  }
}

run();
