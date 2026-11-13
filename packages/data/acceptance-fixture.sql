-- OPERATOR REVIEW REQUIRED. Apply only once to a fresh, approved isolated test
-- application database after migrations. Never run against real business stock.
-- No reset/cleanup is performed; retain rows as acceptance evidence.
SET XACT_ABORT ON;
IF CONVERT(int,SERVERPROPERTY('EngineEdition')) <> 5 OR DB_NAME() = N'master'
  THROW 51100, 'Use an isolated Azure SQL application database.', 1;
BEGIN TRANSACTION;
DECLARE @LockResult int;
EXEC @LockResult = sys.sp_getapplock @Resource = N'Gulnara.Inventory',
  @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
IF @LockResult < 0 THROW 51103, 'Inventory is busy.', 1;
INSERT dbo.Flowers(Id, Name, AvailableStems) VALUES
  ('20000000-0000-4000-8000-000000000001', N'Acceptance shared synthetic stem', 2),
  ('20000000-0000-4000-8000-000000000002', N'Acceptance independent synthetic stem', 10);
INSERT dbo.Designs(Id, Name, Description, Colors, Occasions, Moods, IsPublished, IsSample) VALUES
  ('10000000-0000-4000-8000-000000000001', N'Acceptance shared A', N'Synthetic acceptance only; do not deliver.', N'pink', N'birthday', N'gentle', 1, 0),
  ('10000000-0000-4000-8000-000000000002', N'Acceptance shared B', N'Synthetic acceptance only; do not deliver.', N'pink', N'birthday', N'gentle', 1, 0),
  ('10000000-0000-4000-8000-000000000003', N'Acceptance independent', N'Synthetic acceptance only; do not deliver.', N'white', N'thank you', N'natural', 1, 0),
  ('10000000-0000-4000-8000-000000000004', N'Acceptance sample', N'Unbookable test sample.', N'pink', N'birthday', N'gentle', 1, 1),
  ('10000000-0000-4000-8000-000000000005', N'Acceptance incomplete', N'Unbookable incomplete recipe.', N'pink', N'birthday', N'gentle', 1, 0);
INSERT dbo.DesignStems(DesignId, FlowerId, StemsPerUnit) VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 1),
  ('10000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000002', 1),
  ('10000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', 1);
COMMIT TRANSACTION;
