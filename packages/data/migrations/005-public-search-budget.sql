SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF CONVERT(int,SERVERPROPERTY('EngineEdition'))<>5 OR DB_NAME()<>N'appdb'
  THROW 51500,'Public search requires Azure SQL appdb.',1;
CREATE TABLE dbo.PublicSearchBudget (
  Id int NOT NULL CONSTRAINT PK_PublicSearchBudget PRIMARY KEY,
  Attempts int NOT NULL CONSTRAINT CK_PublicSearchBudget_Attempts CHECK(Attempts BETWEEN 0 AND 20),
  ReportedTokens int NOT NULL CONSTRAINT CK_PublicSearchBudget_Tokens CHECK(ReportedTokens>=0),
  LastAttemptUtc datetime2(3) NULL,
  CONSTRAINT CK_PublicSearchBudget_Id CHECK(Id=1)
);
INSERT dbo.PublicSearchBudget(Id,Attempts,ReportedTokens) VALUES(1,0,0);
GO
CREATE PROCEDURE api.PublicSearchStatus AS
BEGIN
  SET NOCOUNT ON;
  SELECT CONVERT(int,SERVERPROPERTY('EngineEdition')) AS engineEdition,DB_NAME() AS [database],
    (SELECT COUNT(*) FROM dbo.vamahtani_embeddings WHERE EmbeddingModel=N'text-embedding-3-small:1:1536') AS sampleCount,
    (SELECT COUNT(*) FROM dbo.SchemaVersions) AS migrationCount,
    20-Attempts AS remainingRequests
  FROM dbo.PublicSearchBudget WHERE Id=1;
END;
GO
CREATE PROCEDURE api.ClaimPublicSearch AS
BEGIN
  SET NOCOUNT ON;
  UPDATE dbo.PublicSearchBudget
  SET Attempts=Attempts+1,LastAttemptUtc=SYSUTCDATETIME()
  OUTPUT 20-inserted.Attempts AS remainingRequests
  WHERE Id=1 AND Attempts<20;
END;
GO
CREATE PROCEDURE api.RecordPublicSearchTokens @Tokens int AS
BEGIN
  SET NOCOUNT ON;
  IF @Tokens IS NULL OR @Tokens NOT BETWEEN 0 AND 10000 THROW 51501,'Invalid aggregate token count.',1;
  UPDATE dbo.PublicSearchBudget SET ReportedTokens=ReportedTokens+@Tokens WHERE Id=1;
END;
GO
INSERT dbo.SchemaVersions(Version,Checksum) VALUES (5, '$(MigrationHash)');
COMMIT TRANSACTION;
