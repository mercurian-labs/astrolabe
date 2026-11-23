# Electric plus the RDS certificate authorities (ELECTRIC_DATABASE_CA_CERTIFICATE_FILE).
FROM electricsql/electric:1.8.1
COPY rds-us-east-1.pem /etc/ssl/certs/rds-us-east-1.pem
