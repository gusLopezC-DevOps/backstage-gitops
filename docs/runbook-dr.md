# Disaster Recovery Runbook — IDP Lab (single-node k3s)

## Objective
Recover the entire Internal Developer Platform from **zero** (fresh k3s cluster, no data) using only the two Git repositories. No SSH to the old cluster, no stored volumes, no backup files.

Measured RTO target: **< 30 minutes** for basic portal functionality (Backstage serves at backstage.local).
Measured RPO: **last git commit** (catalog entities and TechDocs are rebuilt from source; Postgres state is ephemeral).

---

## Inventory

### Repositories
| Repo | Role | Bootstrap entry |
|---|---|---|
| `gusLopezC-DevOps/control-plane.git` | Cluster infrastructure (ArgoCD, cert-manager, crossplane, kong, kyverno, monitoring, sealed-secrets) | `bootstrap/root-app.yaml` |
| `gusLopezC-DevOps/backstage-gitops.git` | Backstage deployment, config, templates, secrets | `apps/backstage/deployment.yaml` |
| `gusLopezC-DevOps/backstage-app.git` | Application source + CI (image built externally) | Not needed at recovery (image is pulled) |
| `gusLopezC-DevOps/go-frontend-test.git` | Sample service manifests + catalog-info | Synced via ArgoCD app `go-frontend-test` |

### ArgoCD Applications (all auto-sync, prune, self-heal)
| App | Source | Target Namespace |
|---|---|---|
| `argocd` | root-app (control-plane repo) | argocd |
| `backstage-gitops` | backstage-gitops repo, path `apps` | workloads |
| `cert-manager` | root-app | cert-manager |
| `crossplane` | root-app | crossplane-system |
| `go-frontend-test` | go-frontend-test repo, path `.` | go-frontend-test |
| `kong` | root-app | kong |
| `kyverno` | root-app | kyverno |
| `monitoring` | root-app | monitoring |
| `root-app` | control-plane repo, path `overlays/prod` | argocd |
| `sealed-secrets` | control-plane repo, path `overlays/prod/sources/sealed-secrets/chart` | sealed-secrets |

### Critical External Dependencies
- **Docker Hub** (`guslopezc/backstage` image tags) — accessible without auth for public images; PAT for private push stored in CI secrets.
- **GitHub** — repos are semi-public read; GitHub PAT for ArgoCD stored in `argocd-secret` (not in this runbook).
- **Postgres StatefulSet** → data is **ephemeral** (local-path PVC, 8Gi, node-local). Backup/restore is a known gap.
- **Self-signed TLS** → Kong serves `CN=localhost`; no external CA dependency.

### Secrets
Managed via SealedSecrets (encrypted in `backstage-gitops` repo, decrypted by `sealed-secrets-controller` in-cluster):
- `postgres-sealed` (POSTGRES_USER, POSTGRES_PASSWORD)
- `backstage-secrets` (GITHUB_TOKEN, AUTH_GITHUB_CLIENT_ID, AUTH_GITHUB_CLIENT_SECRET)

---

## Full Recovery Procedure (from bare k3s)

### Phase 1 — Base cluster (10 min)

```bash
# 1. Install k3s on Fedora
curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644

# 2. Wait for node Ready
kubectl wait --for=condition=Ready node/fedora --timeout=60s

# 3. Install ArgoCD (standalone, no operator)
kubectl create namespace argocd
kubectl apply -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml -n argocd

# 4. Wait for ArgoCD server
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=argocd-server -n argocd --timeout=120s
```

### Phase 2 — Bootstrap root app (5 min)

```bash
# Clone the gitops repo
git clone https://github.com/gusLopezC-DevOps/backstage-gitops.git
cd backstage-gitops

# Apply root-app (App-of-Apps) — this recreates all infrastructure apps
kubectl apply -f bootstrap/root-app.yaml

# Wait for root-app to sync child apps
# ArgoCD auto-sync will propagate: sealed-secrets, cert-manager, crossplane,
# kong, kyverno, monitoring → each app creates its namespace + resources
sleep 120  # ~2 min for all child apps to reconcile
```

### Phase 3 — Backstage portal (5 min)

```bash
# The backstage-gitops app auto-syncs when root-app creates it
kubectl wait --for=condition=Ready pod -l app=backstage -n workloads --timeout=180s

# Verify portal
curl -sk https://backstage.local/  # OR http://<node-ip>:30081 (Kong NodePort)
```

### Phase 4 — Sample service (5 min, optional)

```bash
# The go-frontend-test app should have synced automatically
kubectl wait --for=condition=Ready pod -l app=go-frontend-test -n go-frontend-test --timeout=120s
```

**Total estimate:** 20 min for base cluster + 5 min for ArgoCD bootstrap + 5 min for portal → **~30 min RTO**.

---

## Safe Drill: Recreate `go-frontend-test` (test the GitOps claim)

### Procedure
```bash
# 1. Record current state
kubectl get pods -n go-frontend-test
TIMESTAMP_START=$(date +%s)

# 2. Delete the namespace
kubectl delete namespace go-frontend-test --wait=false

# 3. The ArgoCD app's auto-sync has self-heal disabled for deleted objects
#    Because ArgoCD auto-sync has `prune: true` but only prunes resources
#    managed by the app. Deleting the namespace removes all resources AND
#    the app's ability to manage them (the app has `destination.namespace`).
#    We need to sync the app to recreate.

# 4. Refresh and sync the go-frontend-test app
argocd app sync go-frontend-test --prune

# 5. Wait for pods to reconcile
kubectl wait --for=condition=Available deployment/go-frontend-test -n go-frontend-test --timeout=120s

# 6. Measure RTO
TIMESTAMP_END=$(date +%s)
echo "RTO: $(( TIMESTAMP_END - TIMESTAMP_START )) seconds"
```

### Known behavior
- ArgoCD recreates the namespace if the `app.spec.destination.namespace` exists at sync time.
- SealedSecrets are not involved here (go-frontend-test uses no secrets).
- The Postgres catalog entity may be stale if the catalog was not re-registered; re-register by re-syncing the catalog-info from GitHub (TechDocs URL-based registration survives).

---

## Recovery Order & Dependencies

```text
k3s install
  └── ArgoCD (standalone install.yaml)
       └── root-app (bootstrap/root-app.yaml)
            ├── sealed-secrets
            │    └── postgres-sealed decrypts → PostgreSQL StatefulSet
            ├── cert-manager
            ├── crossplane
            ├── kong
            ├── kyverno
            └── monitoring
       └── backstage-gitops app (syncs automatically)
            ├── Backstage deployment + service
            │    ├── reads secrets via SealedSecrets controller
            │    └── connects to PostgreSQL (in workloads namespace)
            └── Scaffold templates (ConfigMap: backstage-templates)
       └── go-frontend-test app
            └── Sample service (deployment + service + ingress)
```

**Critical paths:**
- `postgres-sealed` must be decryptable before Backstage starts (the SealedSecrets controller must be running).
- `backstage-templates` ConfigMap must exist before the scaffolder plugin can use templates.
- ArgoCD needs GitHub PAT for repo access (configured in `argocd-secret` or via the `argocd` app manifest).

---

## RTO Measurement Log

| Drill | Date | Target | RTO | Notes |
|---|---|---|---|---|
| (first run) | 2026-09-12 | go-frontend-test namespace | **54 s** | Auto-sync restored namespace, deployment, service, ingress; pod ready |
| (planned) | | Full cluster recovery | | To be measured |

---

## Known Gaps

| Gap | Impact | Mitigation in DR |
|---|---|---|
| **No Postgres backup** | Catalog entities added *after* last commit are lost | TechDocs and entities re-register from source; database is repopulated |
| **Single node SPOF** | If the Fedora machine is unreachable, no DR | This runbook assumes a fresh k3s on the same or new machine |
| **No backup of PVC** | Postgres data is node-local (`/var/lib/rancher/k3s/storage/...`) | Acceptable for a lab — data is rebuilt from git |
| **Self-signed TLS** | Browsers warn; not a DR concern | Proceed to backstage.local → Advanced → Proceed