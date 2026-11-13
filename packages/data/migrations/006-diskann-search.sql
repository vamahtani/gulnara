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
  THROW 51600, 'DiskANN requires Azure SQL appdb.', 1;

ALTER TABLE dbo.vamahtani_embeddings DROP CONSTRAINT CK_vamahtani_embeddings_Id;
ALTER TABLE dbo.vamahtani_embeddings WITH CHECK
  ADD CONSTRAINT CK_vamahtani_embeddings_Id CHECK (Id BETWEEN 1 AND 100);
GO
-- Index construction follows the approved cached seed; a fresh business database
-- can migrate without generating embeddings or claiming search readiness.
CREATE PROCEDURE dbo.BuildBouquetDiskANNIndex
AS
BEGIN
  SET NOCOUNT ON;
  IF (SELECT COUNT(*) FROM dbo.vamahtani_embeddings) <> 100 OR
     (SELECT COUNT(*) FROM dbo.vamahtani_embeddings
       WHERE EmbeddingModel = N'text-embedding-3-small:1:1536' AND IsSample = 1) <> 100
    THROW 51601, 'Seed one hundred matching sample embeddings before building DiskANN.', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'dbo.vamahtani_embeddings')
      AND name = N'IX_vamahtani_embeddings_DiskANN')
    CREATE VECTOR INDEX IX_vamahtani_embeddings_DiskANN
      ON dbo.vamahtani_embeddings(Embedding)
      WITH (METRIC = 'cosine', TYPE = 'DiskANN', MAXDOP = 1);
  IF NOT EXISTS (SELECT 1 FROM sys.vector_indexes AS v
    INNER JOIN sys.index_columns AS c ON c.object_id = v.object_id AND c.index_id = v.index_id
    WHERE v.object_id = OBJECT_ID(N'dbo.vamahtani_embeddings')
      AND v.name = N'IX_vamahtani_embeddings_DiskANN'
      AND c.column_id = COLUMNPROPERTY(v.object_id, N'Embedding', 'ColumnId')
      AND v.vector_index_type = N'DiskANN' AND v.distance_metric = N'cosine'
      AND v.is_disabled = 0 AND v.is_hypothetical = 0
      AND TRY_CONVERT(int, JSON_VALUE(v.build_parameters, '$.Version')) >= 3)
    THROW 51602, 'A current enabled cosine DiskANN index was not verified; preserve existing indexes.', 1;
END;
GO
ALTER PROCEDURE api.SearchBouquetStudies
  @QueryEmbedding nvarchar(max), @EmbeddingModel nvarchar(100), @Top int = 3
WITH EXECUTE AS OWNER
AS
BEGIN
  SET NOCOUNT ON;
  IF @Top IS NULL OR @Top NOT BETWEEN 1 AND 10
    THROW 51401, 'Search result count must be between one and ten.', 1;
  IF @QueryEmbedding IS NULL OR DATALENGTH(@QueryEmbedding) > 131072
    OR ISJSON(@QueryEmbedding, ARRAY) <> 1
    THROW 51401, 'Expected a JSON embedding array.', 1;
  IF (SELECT COUNT(*) FROM OPENJSON(@QueryEmbedding)) <> 1536
    OR EXISTS (SELECT 1 FROM OPENJSON(@QueryEmbedding)
      WHERE type <> 2 OR TRY_CONVERT(real, value) IS NULL
        OR ABS(TRY_CONVERT(float, value)) > 1)
    THROW 51401, 'Expected 1536 finite, normalized embedding components.', 1;
  DECLARE @NormSquared float = (SELECT SUM(POWER(TRY_CONVERT(float, value), 2)) FROM OPENJSON(@QueryEmbedding));
  IF @NormSquared IS NULL OR @NormSquared < 0.999 OR @NormSquared > 1.001
    THROW 51401, 'Expected a nonzero normalized query embedding.', 1;
  IF @EmbeddingModel IS NULL OR @EmbeddingModel <> N'text-embedding-3-small:1:1536'
    OR (SELECT COUNT(*) FROM dbo.vamahtani_embeddings WHERE EmbeddingModel = @EmbeddingModel) <> 100
    THROW 51402, 'One hundred sample studies must be seeded with the matching embedding model.', 1;
  IF NOT EXISTS (SELECT 1 FROM sys.vector_indexes AS v
    INNER JOIN sys.index_columns AS c ON c.object_id = v.object_id AND c.index_id = v.index_id
    WHERE v.object_id = OBJECT_ID(N'dbo.vamahtani_embeddings')
      AND v.name = N'IX_vamahtani_embeddings_DiskANN'
      AND c.column_id = COLUMNPROPERTY(v.object_id, N'Embedding', 'ColumnId')
      AND v.vector_index_type = N'DiskANN' AND v.distance_metric = N'cosine'
      AND v.is_disabled = 0 AND v.is_hypothetical = 0
      AND TRY_CONVERT(int, JSON_VALUE(v.build_parameters, '$.Version')) >= 3)
    THROW 51602, 'Native DiskANN is not ready. Exact-search fallback is disabled.', 1;
  -- FORCE_ANN_ONLY requires an index at compilation. Defer compilation until
  -- the verified seed/index exist, keeping fresh schema migration independent.
  EXEC sys.sp_executesql N'
    DECLARE @Vector VECTOR(1536) = CAST(@Query AS VECTOR(1536));
    SELECT TOP (@Count) WITH APPROXIMATE
      b.Id, b.Name, b.Description, b.ImagePath, b.IllustrativePriceUsd, b.IsSample,
      r.distance AS Distance
    FROM VECTOR_SEARCH(
      TABLE = dbo.vamahtani_embeddings AS b,
      COLUMN = Embedding,
      SIMILAR_TO = @Vector,
      METRIC = ''cosine''
    ) AS r WITH (FORCE_ANN_ONLY)
    WHERE b.EmbeddingModel = @Model
    ORDER BY r.distance;',
    N'@Query nvarchar(max), @Model nvarchar(100), @Count int',
    @Query = @QueryEmbedding, @Model = @EmbeddingModel, @Count = @Top;
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
    20 - b.Attempts AS remainingRequests
  FROM dbo.PublicSearchBudget AS b
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
  WHERE b.Id = 1;
END;
GO
INSERT dbo.SchemaVersions(Version, Checksum) VALUES (6, '$(MigrationHash)');
COMMIT TRANSACTION;
