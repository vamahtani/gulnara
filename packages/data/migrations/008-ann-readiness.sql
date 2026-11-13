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
  THROW 51800, 'ANN readiness requires Azure SQL appdb.', 1;
GO
CREATE PROCEDURE dbo.AssertBouquetANNReady
AS
BEGIN
  SET NOCOUNT ON;
  DECLARE @query nvarchar(max) = (
    SELECT CONVERT(nvarchar(max), Embedding) FROM dbo.vamahtani_embeddings WHERE Id = 11
  );
  DECLARE @results TABLE (Id int, Name nvarchar(120), Description nvarchar(1000),
    ImagePath nvarchar(120), IllustrativePriceUsd decimal(10,2), IsSample bit, Distance float);
  INSERT @results EXEC api.SearchBouquetStudies
    @QueryEmbedding = @query, @EmbeddingModel = N'text-embedding-3-small:1:1536', @Top = 3;
  IF (SELECT COUNT(*) FROM @results) <> 3
    THROW 51801, 'Native ANN graph readiness is not verified. No AI request is authorized.', 1;
END;
GO
ALTER PROCEDURE api.PublicSearchStatus
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  EXEC dbo.AssertBouquetANNReady;
  SELECT CONVERT(int, SERVERPROPERTY('EngineEdition')) AS engineEdition, DB_NAME() AS [database],
    (SELECT COUNT(*) FROM dbo.vamahtani_embeddings
      WHERE EmbeddingModel = N'text-embedding-3-small:1:1536') AS sampleCount,
    (SELECT COUNT(*) FROM dbo.SchemaVersions) AS migrationCount,
    N'diskann' AS searchMethod, CAST(1 AS bit) AS annReady,
    TRY_CONVERT(int, JSON_VALUE(v.build_parameters, '$.Version')) AS vectorIndexVersion,
    b.AttemptLimit AS searchLimit, b.AttemptLimit - b.Attempts AS remainingRequests
  FROM dbo.PublicSearchBudget AS b
  INNER JOIN dbo.PublicSearchAllowanceApprovals AS a ON a.Id = b.Id
  CROSS APPLY (
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
INSERT dbo.SchemaVersions(Version, Checksum) VALUES (8, '$(MigrationHash)');
COMMIT TRANSACTION;
