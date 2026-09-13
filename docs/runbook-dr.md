# Disaster Recovery Runbook — IDP Lab (single-node k3s)

## Objective
Recover the entire Internal Developer Platform from **zero** (fresh k3s, bare metal, no data) using only the two Git repositories. No SSH to the old cluster, no stored volumes, no backup files.

Measured RTO target: **< 45 minutes** for basic portal functionality (Backstage serves at backstage.local).
Measured RPO: **last git commit** (catalog entities and TechDocs are rebuilt from source; Postgres state is ephemeral).

---

## Inventory

### Repositories
| Repo | Role | Bootstrap entry |
|---|---|---|
| `gusLopezC-DevOps/control-plane.git` | Cluster infrastructure: ArgoCD (helm, self-managed), cert-manager, crossplane, kong, kyverno, monitoring, sealed-secrets — **all as Argo Applications + charts** | `bootstrap/project.yaml` + `bootstrap/root-app.yaml`, then `scripts/install.sh` |
| `gusLopezC-DevOps/backstage-gitops.git` | Backstage deployment, config, templates, sealed secrets, kyverno policy + dashboard *fuente* | `bootstrap/app-project.yaml` + `bootstrap/root-app.yaml` |
| `gusLopezC-DevOps/backstage-app.git` | App source + CI (image built externally) | Not needed at recovery (image is pulled) |
| `gusLopezC-DevOps/go-frontend-test.git` | Sample service manifests + catalog-info | Synced via Argo app `go-frontend-test` |

### ArgoCD Applications (all auto-sync, prune, self-heal)
| App | Source | Project | Namespace |
|---|---|---|---|
| `root-app` | control-plane, `overlays/prod` | control-plane | argocd |
| `argocd` | helm chart `argo-cd` 9.5.14 + source `overlays/prod/sources/argocd/values.yaml` | control-plane | argocd |
| `cert-manager` | helm chart 1.17.1 + source values | cert-manager | cert-manager |
| `crossplane` | helm chart 1.20.10 + source values | crossplane | crossplane-system |
| `kong` | helm chart 3.2.0 + source values | kong | kong |
| `kyverno` | helm chart 3.8.1 + source values | kyverno | kyverno |
| `monitoring` | helm chart `kube-prometheus-stack` 85.1.1 + source values | monitoring | monitoring |
| `sealed-secrets` | vendored chart `overlays/prod/sources/sealed-secrets/chart` | sealed-secrets | sealed-secrets |
| `go-frontend-test` | go-frontend-test repo, root | go-frontend-test | go-frontend-test |
| `backstage-gitops` | backstage-gitops repo, `apps` | default | workloads |

> `bootstrap/platform-workloads.yaml` (backstage-gitops) es un Application **huérfano**: el project `platform-workloads`
> sí existe pero esa Application no está aplicada. **No usarla.**

### Lo que NO despliega Argo (se recrea a mano al recuperar)
These five resources are applied imperatively, by design. They are reproduced in Phase 4 of this runbook:

- `ClusterIssuer selfsigned-issuer` (cert-manager)
- `Ingress argocd` (argocd.local) y `Ingress crossplane` (crossplane.local, sobre service `webui` — vestigial)
- `ProviderConfig kubernetes-provider-config` (crossplane, `InjectedIdentity`)
- `ClusterPolicy golden-path` (kyverno) — fuente en `apps/kyverno-policies/golden-path.yaml`
- ConfigMap `platform-health-dashboard` de grafana (label `grafana_dashboard: "1"`) — JSON en `apps/monitoring/manual/platform-dashboard.json`

### Critical External Dependencies
- **Docker Hub** (`guslopezc/backstage` image tags) — public pull; PAT for push is a CI secret, not needed at recovery.
- **GitHub** — repos are public-read; the ArgoCD repo-server only needs read access (public https). The GitHub PAT for CI actions lives in GitHub secrets, not in this runbook.
- **Postgres StatefulSet** → data is **ephemeral** (local-path PVC 8Gi, node-local). Backup/restore is a known gap; DB is re-populated from catalog re-registration.
- **Self-signed TLS** → Kong serves `CN=localhost`; no external CA dependency. Browser warnings expected.

### Secrets
Managed via **SealedSecrets** (encrypted in `backstage-gitops` repo at `apps/backstage/postgres/secret.yaml`):
- `postgres-sealed` (POSTGRES_USER, POSTGRES_PASSWORD)

> **The SealedSecrets private key is NOT recoverable** (no offline backup, by policy). On a **fresh cluster the
> controller generates a new key**, so old sealed values CANNOT be decrypted. After recovery you must **re-seal**
> postgres credentials with the new cert (Phase 5). Anything else that needs a secret is re-created at install
> time (Grafana admin/admin lives in `overlays/prod/sources/monitoring/values.yaml`).

---

## Full Recovery Procedure (from bare k3s)

### Phase 1 — Base cluster (10 min)

```bash
# 1. Install k3s on Fedora
curl -sfL https://get.k3s.io | sh -s - --write-kubeconfig-mode 644

# 2. Wait for node Ready
kubectl wait --for=condition=Ready node/fedora --timeout=60s

# 3. Install ArgoCD with the SAME helm chart Argo uses to self-manage:
#    chart argo-cd 9.5.14, helm repo argoproj, values from control-plane (config/argo-cd/values.yaml or sources/argocd/values.yaml)
git clone https://github.com/gusLopezC-DevOps/control-plane.git /tmp/control-plane
helm repo add argo https://argoproj.github.io/argo-helm
helm install argocd argo/argo-cd \
  --namespace argocd --create-namespace \
  --version 9.5.14 \
  --values /tmp/control-plane/config/argo-cd/values.yaml

# 4. Wait for ArgoCD server
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=argocd-server -n argocd --timeout=180s

# 5. (Optional) expose ArgoCD
kubectl -n argocd port-forward svc/argocd-server 8080:443 &
# admin password:
kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath='{.data.password}' | base64 -d
```

> The helm install reproduces what the `argocd` Application would otherwise manage. Because ArgoCD is not up yet,
> this is the one `helm install` that is done by hand; afterwards the cluster is fully managed through git.

### Phase 2 — Bootstrap the two repos (10 min)

```bash
# 2.1 infrastructure first (control-plane): AppProject control-plane + root-app -> spawns all infra Apps
cd /tmp/control-plane
kubectl apply -f bootstrap/project.yaml
kubectl apply -f bootstrap/root-app.yaml

# 2.2 then the workload repo (backstage-gitops): AppProject platform-workloads + app backstage-gitops
cd /tmp
git clone https://github.com/gusLopezC-DevOps/backstage-gitops.git
cd backstage-gitops
kubectl apply -f bootstrap/app-project.yaml
kubectl apply -f bootstrap/root-app.yaml

# 2.3 wait for sync-waves / child apps (~3 min)
kubectl wait --for=condition=Ready pod -l app.kubernetes.io/name=cert-manager -n cert-manager --timeout=180s 2>/dev/null || true
sleep 120
```

Or simply run `bash /tmp/control-plane/scripts/install.sh` for the control-plane half (it applies project + root-app
and waits for `Synced`). There is **no equivalent script for backstage-gitops**: both `bootstrap/app-project.yaml`
and `bootstrap/root-app.yaml` must be applied by hand.

### Phase 3 — Verificar planes de datos (5 min)

```bash
# Argo health
kubectl -n argocd get app

# Kong proxy is a LoadBalancer; on k3s local it stays on the node IP
kubectl -n kong get svc kong-kong-proxy

# Postgres StatefulSet (data re-populates, but needs the secret first — see Phase 5)
kubectl -n workloads get sts,pvc
```

### Phase 4 — Recreate the imperatively-applied resources (5 min)

```bash
# 4.1 ClusterIssuer selfsigned
kubectl apply -f - <<'EOF'
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: selfsigned-issuer
spec:
  selfSigned: {}
EOF

# 4.2 Ingress argocd (maps HTTPS backend to NodePort service)
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: argocd
  namespace: argocd
  annotations:
    cert-manager.io/cluster-issuer: selfsigned-issuer
    konghq.com/protocols: "http,https"
    ingress.kubernetes.io/backend-protocol: HTTPS
spec:
  ingressClassName: kong
  rules:
  - host: argocd.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: argocd-server
            port:
              number: 443
  tls:
  - hosts: ["argocd.local"]
    secretName: argocd-tls
EOF

# 4.3 Ingress crossplane (vestigial: apunta al service 'webui', que hoy no existe)
kubectl apply -f - <<'EOF'
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: crossplane
  namespace: crossplane-system
  annotations:
    konghq.com/protocols: "http"
spec:
  ingressClassName: kong
  rules:
  - host: crossplane.local
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: webui
            port:
              number: 80
EOF

# 4.4 Crossplane ProviderConfig (InjectedIdentity)
kubectl apply -f - <<'EOF'
apiVersion: kubernetes.crossplane.io/v1alpha1
kind: ProviderConfig
metadata:
  name: kubernetes-provider-config
spec:
  credentials:
    source: InjectedIdentity
EOF

# 4.5 Kyverno golden-path ClusterPolicy (fuente versionada)
kubectl apply -f apps/kyverno-policies/golden-path.yaml

# 4.6 Grafana dashboard ConfigMap (label that the sidecar picks up)
kubectl create cm platform-health-dashboard -n monitoring --from-file=apps/monitoring/manual/platform-dashboard.json \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl label cm platform-health-dashboard -n monitoring grafana_dashboard="1" --overwrite
```

### Phase 5 — Re-seal postgres credentials (5 min, required)

On the **new** cluster the sealed-secrets controller generates a brand-new key, so `apps/backstage/postgres/secret.yaml`
cannot be decrypted as-is. Re-seal with the new cert:

```bash
# kubeseal CLI must read the new controller cert
KUBESEAL_BIN=${KUBESEAL_BIN:-kubeseal}   # or 'kubeseal' via brew/curl binary

# generate the new sealed secret (values are lab-defaults; keep them consistent with postgres secret)

kubectl create secret generic postgres-sealed --namespace workloads \
  --from-literal=POSTGRES_USER=postgres \
  --from-literal=POSTGRES_PASSWORD=your-password \
  --from-literal=POSTGRES_DB=backstage \
  --dry-run=client -o yaml \
  | $KUBESEAL_BIN --format yaml --namespace workloads > apps/backstage/postgres/secret.yaml

# commit the re-sealed secret back to git so the workload becomes reproducible again
git add apps/backstage/postgres/secret.yaml && git commit -m "dr: re-seal postgres credentials for new cluster key" -q && git push
```

> If you do **not** commit the re-sealed value, the next Argo sync may restore the old (undecryptable) sealed secret.
> Re-sealing and committing closes the loop.

### Phase 6 — Verify the portal (5 min)

```bash
kubectl wait --for=condition=Ready pod -l app=backstage -n workloads --timeout=180s
curl -sk https://backstage.local/
```

**Total estimate:** 10 (k3s+argo) + 10 (bootstrap) + 5 (planes) + 5 (imperative) + 5 (re-seal) + 5 (verify) ≈ **~40 min RTO**.

---

## Recovery Order & Dependencies

```text
k3s install
  └── ArgoCD (helm chart 9.5.14, control-plane config/argo-cd/values.yaml)
       └── control-plane bootstrap: project + root-app
            ├── argocd (self-managed)
            ├── sealed-secrets
            ├── cert-manager  → clusterissuer (Phase 4.1)
            ├── crossplane    → providerconfig (Phase 4.4)
            ├── kong          → ingress argocd/crossplane (Phase 4.2-4.3)
            ├── kyverno       → golden-path policy (Phase 4.5)
            └── monitoring    → grafana dashboard CM (Phase 4.6)
       └── backstage-gitops bootstrap: app-project + root-app
            ├── backstage (deployment, service, ingress, certificate, postgres, netpols, templates)
            │    ├── reads postgres-sealed → MUST be re-sealed (Phase 5)
            │    └── connects to PostgreSQL (workloads namespace)
            └── go-frontend-test (synced via its own repo)
```

**Critical paths:**
- `postgres-sealed` must be **re-sealed and committed** before the workload is trustworthy (Phase 5).
- ConfigMaps and templates are in git; no manual generation needed.
- ArgoCD needs read access to all repos (public https is enough).

---

## Known Gaps

| Gap | Impact | Mitigation in DR |
|---|---|---|
| **SealedSecrets private key is not backed up** | Old sealed values undecryptable | Re-seal postgres creds (Phase 5); Grafana admin is plaintext in monitoring values |
| **No Postgres backup** | Catalog entities added after last commit are lost | Re-register entities/TechDocs from source; DB repopulated |
| **Single node SPOF** | If the Fedora machine is unreachable, no DR | Runbook assumes a fresh k3s on the same or new machine |
| **No backup of PVC** | Postgres data is node-local (`/var/lib/rancher/k3s/storage/...`) | Acceptable for a lab — data covered by re-seal + re-registration |
| **Self-signed TLS / DNS `*.local`** | No internal DNS: must map `*.local` in `/etc/hosts` or use node IP | Local `/etc/hosts` entries, or access via Kong NodePort 30081/http |
| **Ingress crossplane** | Points at a not-existing `webui` service (vestigial) | Kept for parity with the old cluster; may be dropped later |

---

## RTO Measurement Log

| Drill | Date | Target | RTO | Notes |
|---|---|---|---|---|
| (first run) | 2026-09-12 | go-frontend-test namespace | **54 s** | Auto-sync restored namespace, deployment, service, ingress; pod ready |
| (planned) | | Full cluster recovery | | To be measured |