# zaffiliate Kubernetes

Minimal manifests for `zaffiliate-api`. Deferred full Helm/Terraform until production SLO demands multi-region.

Apply:
```bash
kubectl apply -f deploy/k8s/deployment.yaml
kubectl create secret generic zaffiliate-env --from-env-file=.env.selfhost
```
Probes: `/healthz` liveness, `/readyz` readiness (DATABASE_URL+REDIS_URL). Non-root, read-only FS, `no-new-privileges` via `securityContext`.
