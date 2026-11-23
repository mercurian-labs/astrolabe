import { describe, expect, it } from "vite-plus/test";

import { openIngress, PUBLIC_SECURITY_GROUP } from "./firewall.ts";

const VPC = "10.40.0.0/16";
const group = (...ingress: unknown[]) => ({ Type: "AWS.EC2.SecurityGroup", Props: { ingress } });
const tcp = (port: number, cidr: { cidrIpv4?: string; cidrIpv6?: string }) => ({
  ipProtocol: "tcp",
  fromPort: port,
  toPort: port,
  ...cidr,
});

describe("openIngress", () => {
  it("passes the VPC-only groups and the public HTTPS rule", () => {
    expect(
      openIngress(
        {
          InternalSecurityGroup: group(tcp(4310, { cidrIpv4: VPC }), tcp(5432, { cidrIpv4: VPC })),
          [PUBLIC_SECURITY_GROUP]: group(tcp(443, { cidrIpv4: "0.0.0.0/0" })),
          Cluster: { Type: "AWS.ECS.Cluster", Props: {} },
        },
        VPC,
      ),
    ).toEqual([]);
  });

  it.each([
    [
      "a service's managed group",
      "Electric/SecurityGroup",
      group(tcp(3000, { cidrIpv4: "0.0.0.0/0" })),
    ],
    [
      "any other port on the public group",
      PUBLIC_SECURITY_GROUP,
      group(tcp(80, { cidrIpv4: "0.0.0.0/0" })),
    ],
    [
      "HTTPS on a group that isn't the public one",
      "Internal",
      group(tcp(443, { cidrIpv4: "0.0.0.0/0" })),
    ],
    ["IPv6", PUBLIC_SECURITY_GROUP, group(tcp(443, { cidrIpv6: "::/0" }))],
    [
      "rules known only at deploy time",
      "Api/SecurityGroup",
      { Type: "AWS.EC2.SecurityGroup", Props: { ingress: {} } },
    ],
  ])("flags %s", (_, fqn, resource) => {
    expect(openIngress({ [fqn]: resource }, VPC)).toHaveLength(1);
  });
});
