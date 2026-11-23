/**
 * A deployed stage's tasks run in public subnets with public addresses (no NAT gateway), so a
 * security group is all that keeps the internet out. An ECS service given none gets Alchemy's
 * managed group, which admits its port from anywhere; this check fails the deploy before then.
 */

/** The one group the internet may reach: the API load balancer's HTTPS listener. */
export const PUBLIC_SECURITY_GROUP = "PublicSecurityGroup";

interface DeclaredResource {
  readonly Type: string;
  readonly Props: unknown;
}

interface IngressRule {
  readonly ipProtocol?: unknown;
  readonly fromPort?: unknown;
  readonly toPort?: unknown;
  readonly cidrIpv4?: unknown;
  readonly cidrIpv6?: unknown;
}

const isPublicHttps = (fqn: string, rule: IngressRule) =>
  fqn === PUBLIC_SECURITY_GROUP &&
  rule.ipProtocol === "tcp" &&
  rule.fromPort === 443 &&
  rule.toPort === 443 &&
  rule.cidrIpv4 === "0.0.0.0/0";

/** Every ingress rule that admits addresses outside the VPC, other than the public HTTPS rule. */
export const openIngress = (
  resources: Readonly<Record<string, DeclaredResource>>,
  vpcCidr: string,
): string[] =>
  Object.entries(resources).flatMap(([fqn, resource]) => {
    if (resource.Type !== "AWS.EC2.SecurityGroup") return [];
    const ingress = (resource.Props as { ingress?: unknown } | undefined)?.ingress ?? [];
    // Rules computed at deploy time (Alchemy's managed group, for one) can't be checked here.
    if (!Array.isArray(ingress)) return [`${fqn}: ingress is only known at deploy time`];
    return (ingress as IngressRule[]).flatMap((rule) => {
      if (isPublicHttps(fqn, rule)) return [];
      if (rule.cidrIpv6 !== undefined) return [`${fqn}: admits ${String(rule.cidrIpv6)}`];
      if (rule.cidrIpv4 !== undefined && rule.cidrIpv4 !== vpcCidr) {
        return [`${fqn}: admits ${String(rule.cidrIpv4)} on port ${String(rule.fromPort)}`];
      }
      return [];
    });
  });
