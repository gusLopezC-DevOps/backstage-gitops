# Backstage GitOps Repository

ArgoCD-managed manifests for the Backstage developer portal.

## Structure

```
apps/
├── backstage/
│   ├── deployment.yaml      # Backstage Deployment
│   ├── service.yaml         # ClusterIP Service
│   ├── ingress.yaml         # Kong Ingress + TLS
│   ├── certificate.yaml     # cert-manager Certificate
│   ├── secret.yaml          # SealedSecret (GitHub tokens)
│   ├── k8s-rbac.yaml        # SA + ClusterRole + Binding
│   ├── postgres/
│   │   ├── statefulset.yaml # PostgreSQL StatefulSet
│   │   ├── service.yaml     # PostgreSQL Service
│   │   └── secret.yaml      # SealedSecret (PG creds)
│   └── network-policies/
│       ├── deny-all.yaml
│       ├── allow-backstage-ingress.yaml
│       ├── allow-postgres-ingress.yaml
│       └── allow-backstage-egress.yaml
├── <dev-apps>/              # Developer microservices
bootstrap/
├── root-app.yaml            # ArgoCD root Application
├── platform-workloads.yaml  # ArgoCD workloads Application
└── app-project.yaml         # AppProject for workloads
```

## Bootstrap

```bash
kubectl apply -f bootstrap/root-app.yaml
kubectl apply -f bootstrap/app-project.yaml
kubectl apply -f bootstrap/platform-workloads.yaml
```

## ArgoCD Sync

Once bootstrapped, ArgoCD will automatically sync:
- Backstage + PostgreSQL in `workloads` namespace
- All developer microservices in `workloads` namespace
- Network policies for zero-trust security
