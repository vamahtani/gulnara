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
  THROW 51300, 'The Gulnara demo requires Azure SQL appdb.', 1;

CREATE TABLE dbo.vamahtani (
  Id int NOT NULL CONSTRAINT PK_vamahtani PRIMARY KEY,
  DemoName nvarchar(120) NOT NULL,
  Note nvarchar(400) NOT NULL,
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_vamahtani_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT CK_vamahtani_Singleton CHECK (Id = 1)
);
INSERT dbo.vamahtani(Id, DemoName, Note)
  VALUES (1, N'Gulnara', N'Created for the Gulnara Azure SQL local-container-to-free-cloud demo.');

CREATE TABLE dbo.DemoDesignEmbeddings (
  Id int NOT NULL CONSTRAINT PK_DemoDesignEmbeddings PRIMARY KEY,
  Name nvarchar(120) NOT NULL,
  Description nvarchar(1000) NOT NULL,
  ImagePath nvarchar(120) NOT NULL,
  Embedding VECTOR(1536) NOT NULL,
  EmbeddingModel nvarchar(100) NOT NULL,
  SeedChecksum char(64) NOT NULL,
  IsSample bit NOT NULL CONSTRAINT DF_DemoDesignEmbeddings_Sample DEFAULT 1,
  CONSTRAINT CK_DemoDesignEmbeddings_Sample CHECK (IsSample = 1),
  CONSTRAINT CK_DemoDesignEmbeddings_Id CHECK (Id BETWEEN 1 AND 6)
);
GO
CREATE PROCEDURE api.SearchDemoStudies
  @QueryEmbedding nvarchar(max), @EmbeddingModel nvarchar(100), @Top int = 3
AS
BEGIN
  SET NOCOUNT ON;
  IF @Top IS NULL OR @Top NOT BETWEEN 1 AND 6
    THROW 51301, 'Search result count must be between one and six.', 1;
  IF @QueryEmbedding IS NULL OR DATALENGTH(@QueryEmbedding) > 131072
    OR ISJSON(@QueryEmbedding, ARRAY) <> 1
    THROW 51301, 'Expected a JSON embedding array.', 1;
  IF (SELECT COUNT(*) FROM OPENJSON(@QueryEmbedding)) <> 1536
    OR EXISTS (SELECT 1 FROM OPENJSON(@QueryEmbedding)
      WHERE type <> 2 OR TRY_CONVERT(real, value) IS NULL
        OR ABS(TRY_CONVERT(float, value)) > 1)
    THROW 51301, 'Expected 1536 finite, normalized embedding components.', 1;
  IF NOT EXISTS (SELECT 1 FROM OPENJSON(@QueryEmbedding) WHERE TRY_CONVERT(real, value) <> 0)
    THROW 51301, 'A zero embedding cannot be searched.', 1;
  DECLARE @NormSquared float = (SELECT SUM(POWER(TRY_CONVERT(float, value), 2)) FROM OPENJSON(@QueryEmbedding));
  IF @NormSquared < 0.999 OR @NormSquared > 1.001
    THROW 51301, 'Expected a normalized query embedding.', 1;
  IF @EmbeddingModel IS NULL OR LEN(@EmbeddingModel) = 0
    OR NOT EXISTS (SELECT 1 FROM dbo.DemoDesignEmbeddings WHERE EmbeddingModel = @EmbeddingModel)
    OR EXISTS (SELECT 1 FROM dbo.DemoDesignEmbeddings WHERE EmbeddingModel <> @EmbeddingModel)
    THROW 51302, 'Seeded studies and query must use the same embedding model.', 1;
  DECLARE @Vector VECTOR(1536) = CAST(@QueryEmbedding AS VECTOR(1536));
  SELECT TOP (@Top) Id, Name, Description, ImagePath, IsSample,
    VECTOR_DISTANCE('cosine', Embedding, @Vector) AS Distance
  FROM dbo.DemoDesignEmbeddings
  WHERE EmbeddingModel = @EmbeddingModel
  ORDER BY VECTOR_DISTANCE('cosine', Embedding, @Vector), Id;
END;
GO
INSERT dbo.SchemaVersions(Version, Checksum) VALUES (3, '$(MigrationHash)');
COMMIT TRANSACTION;
