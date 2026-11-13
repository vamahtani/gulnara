SET NOCOUNT ON;
SET XACT_ABORT OFF;
IF CONVERT(int,SERVERPROPERTY('EngineEdition'))<>5 OR DB_NAME()<>N'appdb'
  THROW 51510,'Unexpected native acceptance target.',1;
IF EXISTS(SELECT 1 FROM sys.database_principals WHERE name=N'gulnara_public_acceptance')
  THROW 51511,'Acceptance principal already exists.',1;
DECLARE @beforeAttempts int=(SELECT Attempts FROM dbo.PublicSearchBudget WHERE Id=1);
DECLARE @beforeTokens int=(SELECT ReportedTokens FROM dbo.PublicSearchBudget WHERE Id=1);
DECLARE @query nvarchar(max)=(SELECT CONVERT(nvarchar(max),Embedding) FROM dbo.vamahtani_embeddings WHERE Id=1);
BEGIN TRANSACTION;
CREATE USER gulnara_public_acceptance WITHOUT LOGIN;
GRANT EXECUTE ON OBJECT::api.PublicSearchStatus TO gulnara_public_acceptance;
GRANT EXECUTE ON OBJECT::api.ClaimPublicSearch TO gulnara_public_acceptance;
GRANT EXECUTE ON OBJECT::api.RecordPublicSearchTokens TO gulnara_public_acceptance;
GRANT EXECUTE ON OBJECT::api.SearchBouquetStudies TO gulnara_public_acceptance;
UPDATE dbo.PublicSearchBudget SET Attempts=0,ReportedTokens=0 WHERE Id=1;
EXECUTE AS USER=N'gulnara_public_acceptance';
DECLARE @denials int=0;
BEGIN TRY
  SELECT TOP(1) Id FROM dbo.vamahtani_embeddings;
END TRY
BEGIN CATCH
  IF ERROR_NUMBER()<>229 THROW;
  SET @denials+=1;
END CATCH;
BEGIN TRY
  UPDATE dbo.PublicSearchBudget SET Attempts=0 WHERE Id=1;
END TRY
BEGIN CATCH
  IF ERROR_NUMBER()<>229 THROW;
  SET @denials+=1;
END CATCH;
IF @denials<>2 THROW 51512,'Runtime table permissions are too broad.',1;
DECLARE @claims TABLE(remainingRequests int);
DECLARE @i int=0;
WHILE @i<21
BEGIN
  INSERT @claims EXEC api.ClaimPublicSearch;
  SET @i+=1;
END;
IF (SELECT COUNT(*) FROM @claims)<>20 OR
   (SELECT MIN(remainingRequests) FROM @claims)<>0 OR
   (SELECT MAX(remainingRequests) FROM @claims)<>19
  THROW 51513,'Native twenty-attempt boundary failed.',1;
DECLARE @rank TABLE(Id int,Name nvarchar(160),Description nvarchar(1200),
  ImagePath nvarchar(200),IllustrativePriceUsd decimal(10,2),IsSample bit,Distance float);
INSERT @rank EXEC api.SearchBouquetStudies @QueryEmbedding=@query,
  @EmbeddingModel=N'text-embedding-3-small:1:1536',@Top=3;
IF (SELECT COUNT(*) FROM @rank)<>3 OR
   NOT EXISTS(SELECT 1 FROM @rank WHERE Id=1 AND Distance<0.000001)
  THROW 51514,'Native granted vector search failed.',1;
EXEC api.RecordPublicSearchTokens @Tokens=10000;
REVERT;
IF (SELECT Attempts FROM dbo.PublicSearchBudget WHERE Id=1)<>20
  THROW 51515,'Native quota was not durable inside its transaction.',1;
ROLLBACK TRANSACTION;
IF (SELECT Attempts FROM dbo.PublicSearchBudget WHERE Id=1)<>@beforeAttempts OR
   (SELECT ReportedTokens FROM dbo.PublicSearchBudget WHERE Id=1)<>@beforeTokens OR
   EXISTS(SELECT 1 FROM sys.database_principals WHERE name=N'gulnara_public_acceptance')
  THROW 51516,'Acceptance transaction did not preserve the database.',1;
SELECT CONVERT(int,SERVERPROPERTY('EngineEdition')) AS engineEdition,
  DB_NAME() AS [database],20 AS acceptedClaims,1 AS rejectedExtraClaim,
  2 AS runtimeTableDenials,3 AS nativeRankedResults,
  @beforeAttempts AS preservedAttempts,@beforeTokens AS preservedTokens
FOR JSON PATH,WITHOUT_ARRAY_WRAPPER;
GO
