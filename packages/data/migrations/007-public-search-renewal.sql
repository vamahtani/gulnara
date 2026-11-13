SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF CONVERT(int, SERVERPROPERTY('EngineEdition')) <> 5 OR DB_NAME() <> N'appdb'
  THROW 51700, 'Public allowance renewal requires Azure SQL appdb.', 1;
IF (SELECT COUNT(*) FROM dbo.PublicSearchBudget) <> 1
  THROW 51702, 'Preserve and review the existing public budget; do not recreate it.', 1;
CREATE TABLE dbo.PublicSearchAllowanceApprovals (
  Id int NOT NULL CONSTRAINT PK_PublicSearchAllowanceApprovals PRIMARY KEY,
  ApprovedAtUtc datetime2(3) NOT NULL,
  AdditionalAttempts int NOT NULL CONSTRAINT CK_PublicSearchAllowanceApprovals_Additional CHECK (AdditionalAttempts = 100),
  PriorAttemptLimit int NOT NULL CONSTRAINT CK_PublicSearchAllowanceApprovals_Limit CHECK (PriorAttemptLimit = 20),
  PriorAttempts int NOT NULL CONSTRAINT CK_PublicSearchAllowanceApprovals_Attempts CHECK (PriorAttempts BETWEEN 0 AND 20),
  PriorReportedTokens int NOT NULL CONSTRAINT CK_PublicSearchAllowanceApprovals_Tokens CHECK (PriorReportedTokens >= 0),
  CONSTRAINT CK_PublicSearchAllowanceApprovals_Id CHECK (Id = 1)
);
INSERT dbo.PublicSearchAllowanceApprovals
  (Id, ApprovedAtUtc, AdditionalAttempts, PriorAttemptLimit, PriorAttempts, PriorReportedTokens)
SELECT Id, SYSUTCDATETIME(), 100, 20, Attempts, ReportedTokens
FROM dbo.PublicSearchBudget WHERE Id = 1;
ALTER TABLE dbo.PublicSearchBudget ADD AttemptLimit int NOT NULL
  CONSTRAINT DF_PublicSearchBudget_Limit DEFAULT (20);
GO
ALTER TABLE dbo.PublicSearchBudget DROP CONSTRAINT CK_PublicSearchBudget_Attempts;
ALTER TABLE dbo.PublicSearchBudget ADD CONSTRAINT CK_PublicSearchBudget_Limit CHECK (AttemptLimit IN (20, 120));
ALTER TABLE dbo.PublicSearchBudget ADD CONSTRAINT CK_PublicSearchBudget_Attempts CHECK (Attempts >= 0 AND Attempts <= AttemptLimit);
UPDATE dbo.PublicSearchBudget SET AttemptLimit = AttemptLimit + 100 WHERE Id = 1 AND AttemptLimit = 20;
IF @@ROWCOUNT <> 1 THROW 51703, 'The approved hundred-search renewal was not applied exactly once.', 1;
GO
ALTER PROCEDURE api.ClaimPublicSearch
AS
BEGIN
  SET NOCOUNT ON;
  UPDATE b
  SET Attempts = Attempts + 1, LastAttemptUtc = SYSUTCDATETIME()
  OUTPUT inserted.AttemptLimit - inserted.Attempts AS remainingRequests
  FROM dbo.PublicSearchBudget AS b
  INNER JOIN dbo.PublicSearchAllowanceApprovals AS a ON a.Id = b.Id
  WHERE b.Id = 1 AND b.AttemptLimit = a.PriorAttemptLimit + a.AdditionalAttempts
    AND b.Attempts >= a.PriorAttempts AND b.ReportedTokens >= a.PriorReportedTokens
    AND b.Attempts < b.AttemptLimit;
END;
GO
ALTER PROCEDURE api.PublicSearchStatus
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  SELECT CONVERT(int, SERVERPROPERTY('EngineEdition')) AS engineEdition, DB_NAME() AS [database],
    (SELECT COUNT(*) FROM dbo.vamahtani_embeddings
      WHERE EmbeddingModel = N'text-embedding-3-small:1:1536') AS sampleCount,
    (SELECT COUNT(*) FROM dbo.SchemaVersions) AS migrationCount,
    CASE WHEN v.index_id IS NOT NULL THEN N'diskann' ELSE N'unavailable' END AS searchMethod,
    TRY_CONVERT(int, JSON_VALUE(v.build_parameters, '$.Version')) AS vectorIndexVersion,
    b.AttemptLimit AS searchLimit, b.AttemptLimit - b.Attempts AS remainingRequests
  FROM dbo.PublicSearchBudget AS b
  INNER JOIN dbo.PublicSearchAllowanceApprovals AS a ON a.Id = b.Id
  OUTER APPLY (
    SELECT TOP (1) i.index_id, i.build_parameters
    FROM sys.vector_indexes AS i
    INNER JOIN sys.index_columns AS c ON c.object_id = i.object_id AND c.index_id = i.index_id
    WHERE i.object_id = OBJECT_ID(N'dbo.vamahtani_embeddings')
      AND i.name = N'IX_vamahtani_embeddings_DiskANN'
      AND c.column_id = COLUMNPROPERTY(i.object_id, N'Embedding', 'ColumnId')
      AND i.vector_index_type = N'DiskANN' AND i.distance_metric = N'cosine'
      AND i.is_disabled = 0 AND i.is_hypothetical = 0
      AND TRY_CONVERT(int, JSON_VALUE(i.build_parameters, '$.Version')) >= 3
  ) AS v
  WHERE b.Id = 1 AND b.AttemptLimit = a.PriorAttemptLimit + a.AdditionalAttempts
    AND b.Attempts >= a.PriorAttempts AND b.ReportedTokens >= a.PriorReportedTokens;
END;
GO
INSERT dbo.SchemaVersions(Version, Checksum) VALUES (7, '$(MigrationHash)');
COMMIT TRANSACTION;
