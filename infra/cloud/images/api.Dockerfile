# The API's environment: Bun plus the RDS certificate authorities, which a deployed stage's
# database clients verify against (NODE_EXTRA_CA_CERTS). Alchemy layers the bundle on top.
FROM oven/bun:1.3
COPY rds-us-east-1.pem /etc/ssl/certs/rds-us-east-1.pem
