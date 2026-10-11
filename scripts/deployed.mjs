#!/usr/bin/env node
// The commit a Worker's live version was deployed from: the tag CI gives each deploy
// (wrangler deploy --tag <commit>). Prints nothing when the live version has none (deployed
// by hand, or before CI deployed it), which deploy.yml takes as "deploy it".
//
//   node scripts/deployed.mjs <worker name>      needs CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID

const [name] = process.argv.slice(2);
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!name || !token || !account) {
  console.error('usage: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… node scripts/deployed.mjs <worker name>');
  process.exit(64);
}
const api = async (path) => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${name}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error(`deployed: ${name}${path}: ${r.status} ${JSON.stringify(body.errors || body).slice(0, 300)}`);
    process.exit(1);
  }
  return body.result;
};
const { deployments = [] } = await api('/deployments');
const live = deployments[0]?.versions?.find((v) => v.percentage === 100);
if (live) {
  const version = await api(`/versions/${live.version_id}`);
  process.stdout.write(version.annotations?.['workers/tag'] || '');
}
