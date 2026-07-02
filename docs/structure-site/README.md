# structure.10camp.com — System Structure viewer

Static single-page view of `docs/SYSTEM_GOVERNANCE.md` (Objective / Pipeline / SOP).

- **Live:** https://structure.10camp.com
- **Host:** separate Netlify site `tencamp-structure` (id 8f8f59d1-2634-4f8e-a817-10b4c3f07c27), NOT the pos-site git auto-deploy.
- **DNS:** Cloudflare CNAME `structure` → tencamp-structure.netlify.app, **proxied=true** (Cloudflare Universal SSL; zone SSL mode "full").

## Redeploy after editing index.html
```bash
export NETLIFY_AUTH_TOKEN=$(grep '^NETLIFY_AUTH_TOKEN=' ~/.claude/.env | cut -d= -f2-)
netlify deploy --prod --dir docs/structure-site --site 8f8f59d1-2634-4f8e-a817-10b4c3f07c27 --skip-functions-cache
# (deploy from a functions-free dir if it tries to bundle pos-site functions)
```
Keep this page in sync when SYSTEM_GOVERNANCE.md changes.
