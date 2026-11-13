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
  THROW 51400, 'The Gulnara collection requires Azure SQL appdb.', 1;

CREATE TABLE dbo.vamahtani_embeddings (
  Id int NOT NULL CONSTRAINT PK_vamahtani_embeddings PRIMARY KEY,
  Name nvarchar(120) NOT NULL,
  Description nvarchar(1000) NOT NULL,
  ImagePath nvarchar(120) NOT NULL,
  IllustrativePriceUsd decimal(10,2) NOT NULL,
  Embedding VECTOR(1536) NOT NULL,
  EmbeddingModel nvarchar(100) NOT NULL,
  SeedChecksum char(64) NOT NULL,
  IsSample bit NOT NULL CONSTRAINT DF_vamahtani_embeddings_Sample DEFAULT 1,
  CONSTRAINT CK_vamahtani_embeddings_Sample CHECK (IsSample = 1),
  CONSTRAINT CK_vamahtani_embeddings_Id CHECK (Id BETWEEN 1 AND 40),
  CONSTRAINT CK_vamahtani_embeddings_Price CHECK (IllustrativePriceUsd > 0 AND IllustrativePriceUsd <= 10000),
  CONSTRAINT CK_vamahtani_embeddings_Image CHECK (ImagePath IN (N'/maison-blush.svg', N'/maison-calla.svg', N'/maison-wine.svg'))
);
GO
CREATE PROCEDURE api.SearchBouquetStudies
  @QueryEmbedding nvarchar(max), @EmbeddingModel nvarchar(100), @Top int = 3
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
    OR (SELECT COUNT(*) FROM dbo.vamahtani_embeddings WHERE EmbeddingModel = @EmbeddingModel) <> 40
    THROW 51402, 'Forty sample studies must be seeded with the matching embedding model.', 1;
  DECLARE @Vector VECTOR(1536) = CAST(@QueryEmbedding AS VECTOR(1536));
  SELECT TOP (@Top) Id, Name, Description, ImagePath, IllustrativePriceUsd, IsSample,
    VECTOR_DISTANCE('cosine', Embedding, @Vector) AS Distance
  FROM dbo.vamahtani_embeddings
  WHERE EmbeddingModel = @EmbeddingModel
  ORDER BY VECTOR_DISTANCE('cosine', Embedding, @Vector), Id;
END;
GO
INSERT dbo.SchemaVersions(Version, Checksum) VALUES (4, '$(MigrationHash)');
COMMIT TRANSACTION;
