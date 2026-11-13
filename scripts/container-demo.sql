-- Local: 127.0.0.1,14331 / appdb.
-- Cloud demo: vamahtani.database.windows.net / gulnara_db_demo.
-- Preserved previous cloud database: gulnara_db.
-- Read-only: no embedding-model requests, database writes or budget claims.

-- 1. Azure SQL engine identity. The VS Code endpoint identifies local vs cloud.
IF DB_NAME() NOT IN (N'appdb', N'gulnara_db', N'gulnara_db_demo')
    THROW 50000, 'Select local appdb or an approved Gulnara cloud connection.', 1;
IF CONVERT(int, SERVERPROPERTY('EngineEdition')) <> 5
    THROW 50001, 'This demo requires the Azure SQL Database engine.', 1;

SELECT
    CONVERT(nvarchar(128), SERVERPROPERTY('ServerName')) AS ServerName,
    CONVERT(int, SERVERPROPERTY('EngineEdition')) AS EngineEdition,
    CONVERT(nvarchar(32), SERVERPROPERTY('Edition')) AS Edition,
    DB_NAME() AS DatabaseName;

-- 2. Native vector storage, not a JSON/text column.
SELECT c.name AS ColumnName, t.name AS DataType,
    c.vector_dimensions AS Dimensions,
    c.vector_base_type_desc AS ElementType
FROM sys.columns AS c
JOIN sys.types AS t ON c.user_type_id = t.user_type_id
WHERE c.object_id = OBJECT_ID(N'dbo.vamahtani_embeddings')
    AND c.name = N'Embedding';

SELECT COUNT(*) AS StoredVectors
FROM dbo.vamahtani_embeddings;

-- 3. The existing approximate-nearest-neighbor index.
SELECT name AS IndexName, vector_index_type AS IndexType,
    distance_metric AS DistanceMetric,
    JSON_VALUE(build_parameters, '$.Version') AS IndexVersion
FROM sys.vector_indexes
WHERE object_id = OBJECT_ID(N'dbo.vamahtani_embeddings');

-- 4. Reuse a real composition's stored embedding; this is not a new text query.
DECLARE @SourceId int = 223;
DECLARE @QueryVector VECTOR(1536);
DECLARE @EmbeddingModel nvarchar(100);

SELECT @QueryVector = Embedding, @EmbeddingModel = EmbeddingModel
FROM dbo.vamahtani_embeddings
WHERE Id = @SourceId;

IF @QueryVector IS NULL
    THROW 50002, 'The demonstration composition is missing.', 1;

SELECT Id AS SourceId, Name AS SourceComposition, Description
FROM dbo.vamahtani_embeddings
WHERE Id = @SourceId;

-- 5. Exact cosine-distance ranking. This scans; it does not demonstrate DiskANN.
-- Lower distance means closer meaning, not a confidence percentage.
SELECT TOP (5) Id, Name,
    CAST(VECTOR_DISTANCE('cosine', Embedding, @QueryVector) AS decimal(8,4))
        AS CosineDistance
FROM dbo.vamahtani_embeddings
WHERE EmbeddingModel = @EmbeddingModel
ORDER BY VECTOR_DISTANCE('cosine', Embedding, @QueryVector), Id;

-- 6. Indexed approximate search, matching the application's native query shape.
-- Enable Actual Execution Plan in VS Code to inspect the Vector Index Seek.
-- Run sections 4-6 together so the query variables are declared.
SELECT TOP (5) WITH APPROXIMATE
    b.Id, b.Name, b.Description,
    CAST(r.distance AS decimal(8,4)) AS CosineDistance
FROM VECTOR_SEARCH(
    TABLE = dbo.vamahtani_embeddings AS b,
    COLUMN = Embedding,
    SIMILAR_TO = @QueryVector,
    METRIC = 'cosine'
) AS r WITH (FORCE_ANN_ONLY)
WHERE b.EmbeddingModel = @EmbeddingModel
ORDER BY r.distance;
