IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'app_runtime')
  CREATE USER app_runtime FOR LOGIN app_api;
REVOKE SELECT ON OBJECT::api.Items FROM app_runtime;
REVOKE EXECUTE ON OBJECT::api.CreateItem FROM app_runtime;
GRANT SELECT ON OBJECT::api.Catalog TO app_runtime;
GRANT SELECT ON OBJECT::api.Bookings TO app_runtime;
GRANT EXECUTE ON OBJECT::api.BookBouquet TO app_runtime;
DENY SELECT, INSERT, UPDATE, DELETE ON SCHEMA::dbo TO app_runtime;
