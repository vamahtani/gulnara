SET NOCOUNT ON;
IF CONVERT(int, SERVERPROPERTY('EngineEdition')) <> 5 OR DB_NAME() <> N'appdb'
  THROW 51610, 'Unexpected DiskANN acceptance target.', 1;
IF (SELECT COUNT(*) FROM dbo.vamahtani_embeddings) NOT IN (100, 300)
  THROW 51611, 'The complete real-embedding corpus is required.', 1;
IF NOT EXISTS (SELECT 1 FROM sys.vector_indexes
  WHERE object_id = OBJECT_ID(N'dbo.vamahtani_embeddings')
    AND name = N'IX_vamahtani_embeddings_DiskANN'
    AND vector_index_type = N'DiskANN' AND distance_metric = N'cosine'
    AND is_disabled = 0 AND TRY_CONVERT(int, JSON_VALUE(build_parameters, '$.Version')) >= 3)
  THROW 51612, 'Current native cosine DiskANN index not verified.', 1;
DECLARE @query nvarchar(max) = (
  SELECT CONVERT(nvarchar(max), Embedding) FROM dbo.vamahtani_embeddings WHERE Id = 11
);
DECLARE @rank TABLE (Id int, Name nvarchar(120), Description nvarchar(1000),
  ImagePath nvarchar(120), IllustrativePriceUsd decimal(10,2), IsSample bit, Distance float);
INSERT @rank EXEC api.SearchBouquetStudies
  @QueryEmbedding = @query, @EmbeddingModel = N'text-embedding-3-small:1:1536', @Top = 3;
IF (SELECT COUNT(*) FROM @rank) <> 3 OR
   (SELECT COUNT(DISTINCT Id) FROM @rank) <> 3 OR
   EXISTS (SELECT 1 FROM @rank WHERE Distance NOT BETWEEN 0 AND 2 OR IsSample <> 1) OR
   NOT EXISTS (SELECT 1 FROM @rank WHERE Id = 11 AND Distance < 0.000001)
  THROW 51613, 'Native DiskANN RPC did not return valid nearest neighbors.', 1;
DECLARE @denials int = 0;
BEGIN TRY
  EXEC api.SearchBouquetStudies @QueryEmbedding = N'[0,0]',
    @EmbeddingModel = N'text-embedding-3-small:1:1536';
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() <> 51401 THROW;
  SET @denials += 1;
END CATCH;
BEGIN TRY
  EXEC api.SearchBouquetStudies @QueryEmbedding = @query,
    @EmbeddingModel = N'wrong-model';
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() <> 51402 THROW;
  SET @denials += 1;
END CATCH;
BEGIN TRY
  EXEC api.SearchBouquetStudies @QueryEmbedding = @query,
    @EmbeddingModel = N'text-embedding-3-small:1:1536', @Top = 11;
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() <> 51401 THROW;
  SET @denials += 1;
END CATCH;
IF @denials <> 3 THROW 51614, 'Search validation denials did not fire.', 1;
EXECUTE AS USER = N'app_runtime';
BEGIN TRY
  EXEC dbo.BuildBouquetDiskANNIndex;
END TRY
BEGIN CATCH
  IF ERROR_NUMBER() <> 229 BEGIN REVERT; THROW; END;
  SET @denials += 1;
END CATCH;
REVERT;
IF @denials <> 4 THROW 51615, 'The customer runtime can invoke index administration.', 1;
SELECT 3 AS nativeResults, 3 AS invalidInputDenials, 1 AS runtimeAdminDenial
FOR JSON PATH, WITHOUT_ARRAY_WRAPPER;
GO
SET STATISTICS XML ON;
DECLARE @query nvarchar(max) = (
  SELECT CONVERT(nvarchar(max), Embedding) FROM dbo.vamahtani_embeddings WHERE Id = 11
);
EXEC api.SearchBouquetStudies @QueryEmbedding = @query,
  @EmbeddingModel = N'text-embedding-3-small:1:1536', @Top = 3;
SET STATISTICS XML OFF;
GO
