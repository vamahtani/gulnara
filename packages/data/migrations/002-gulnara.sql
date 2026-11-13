SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF CONVERT(int, SERVERPROPERTY('EngineEdition')) <> 5 OR DB_NAME() = N'master'
  THROW 51100, 'Gulnara requires an Azure SQL application database.', 1;

CREATE TABLE dbo.Flowers (
  Id uniqueidentifier NOT NULL CONSTRAINT PK_Flowers PRIMARY KEY DEFAULT NEWID(),
  Name nvarchar(120) NOT NULL,
  AvailableStems int NOT NULL CONSTRAINT DF_Flowers_Stock DEFAULT 0,
  CONSTRAINT CK_Flowers_Stock CHECK (AvailableStems BETWEEN 0 AND 1000000)
);
CREATE TABLE dbo.Designs (
  Id uniqueidentifier NOT NULL CONSTRAINT PK_Designs PRIMARY KEY DEFAULT NEWID(),
  Name nvarchar(120) NOT NULL,
  Description nvarchar(600) NOT NULL,
  Colors nvarchar(200) NOT NULL,
  Occasions nvarchar(200) NOT NULL,
  Moods nvarchar(200) NOT NULL,
  IsPublished bit NOT NULL CONSTRAINT DF_Designs_Published DEFAULT 0,
  IsSample bit NOT NULL CONSTRAINT DF_Designs_Sample DEFAULT 1,
  CONSTRAINT CK_Designs_Name CHECK (LEN(TRIM(Name)) > 0),
  CONSTRAINT CK_Designs_Description CHECK (LEN(TRIM(Description)) > 0)
);
CREATE TABLE dbo.DesignStems (
  DesignId uniqueidentifier NOT NULL REFERENCES dbo.Designs(Id),
  FlowerId uniqueidentifier NOT NULL REFERENCES dbo.Flowers(Id),
  StemsPerUnit int NOT NULL,
  CONSTRAINT PK_DesignStems PRIMARY KEY (DesignId, FlowerId),
  CONSTRAINT CK_DesignStems_Quantity CHECK (StemsPerUnit BETWEEN 1 AND 1000)
);
CREATE TABLE dbo.Bookings (
  Id uniqueidentifier NOT NULL CONSTRAINT PK_Bookings PRIMARY KEY DEFAULT NEWID(),
  OwnerId uniqueidentifier NOT NULL,
  RequestId uniqueidentifier NOT NULL,
  RequestHash binary(32) NOT NULL,
  DesignId uniqueidentifier NOT NULL REFERENCES dbo.Designs(Id),
  DesignName nvarchar(120) NOT NULL,
  Size varchar(12) NOT NULL,
  Preferences nvarchar(max) NOT NULL,
  CustomerName nvarchar(120) NOT NULL,
  Email nvarchar(254) NOT NULL,
  RecipientName nvarchar(120) NOT NULL,
  DeliveryAddress nvarchar(500) NOT NULL,
  DeliveryDate date NOT NULL,
  CardMessage nvarchar(500) NOT NULL,
  Status varchar(24) NOT NULL CONSTRAINT DF_Bookings_Status DEFAULT 'requested',
  CreatedAt datetime2 NOT NULL CONSTRAINT DF_Bookings_Created DEFAULT SYSUTCDATETIME(),
  CONSTRAINT UQ_Bookings_Request UNIQUE (OwnerId, RequestId),
  CONSTRAINT CK_Bookings_Size CHECK (Size IN ('petite', 'signature', 'grand')),
  CONSTRAINT CK_Bookings_Status CHECK (Status = 'requested'),
  CONSTRAINT CK_Bookings_Contact CHECK (LEN(TRIM(CustomerName)) > 0 AND LEN(TRIM(RecipientName)) > 0 AND LEN(TRIM(DeliveryAddress)) > 0),
  CONSTRAINT CK_Bookings_Preferences CHECK (ISJSON(Preferences) = 1 AND DATALENGTH(Preferences) <= 16000)
);
CREATE INDEX IX_Bookings_Owner_Created ON dbo.Bookings(OwnerId, CreatedAt DESC);
CREATE TABLE dbo.BookingStems (
  BookingId uniqueidentifier NOT NULL REFERENCES dbo.Bookings(Id),
  FlowerId uniqueidentifier NOT NULL REFERENCES dbo.Flowers(Id),
  ReservedStems int NOT NULL,
  CONSTRAINT PK_BookingStems PRIMARY KEY (BookingId, FlowerId),
  CONSTRAINT CK_BookingStems_Quantity CHECK (ReservedStems BETWEEN 1 AND 3000)
);
GO
CREATE VIEW api.Catalog AS
  SELECT d.Id, d.Name, d.Description, d.Colors, d.Occasions, d.Moods,
    MIN(f.AvailableStems / r.StemsPerUnit) AS AvailableUnits
  FROM dbo.Designs d
  JOIN dbo.DesignStems r ON r.DesignId = d.Id
  JOIN dbo.Flowers f ON f.Id = r.FlowerId
  WHERE d.IsPublished = 1 AND d.IsSample = 0
    AND TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'oid')) IS NOT NULL
  GROUP BY d.Id, d.Name, d.Description, d.Colors, d.Occasions, d.Moods;
GO
CREATE VIEW api.Bookings AS
  SELECT Id, DesignName, Size, DeliveryDate, RecipientName, DeliveryAddress, Status, CreatedAt
  FROM dbo.Bookings
  WHERE OwnerId = TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'oid'));
GO
CREATE PROCEDURE api.BookBouquet
  @RequestId uniqueidentifier, @DesignId uniqueidentifier,
  @Size nvarchar(max), @Preferences nvarchar(max),
  @CustomerName nvarchar(max), @Email nvarchar(max),
  @RecipientName nvarchar(max), @DeliveryAddress nvarchar(max),
  @DeliveryDate nvarchar(max), @CardMessage nvarchar(max)
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  DECLARE @OwnerId uniqueidentifier = TRY_CONVERT(uniqueidentifier, SESSION_CONTEXT(N'oid'));
  IF @OwnerId IS NULL THROW 51101, 'A validated identity is required.', 1;
  IF @RequestId IS NULL OR @DesignId IS NULL THROW 51102, 'Request and design IDs are required.', 1;
  IF @Size IS NULL OR @Size COLLATE Latin1_General_100_BIN2 NOT IN (N'petite', N'signature', N'grand')
    OR DATALENGTH(@Size) <> CASE @Size WHEN N'petite' THEN 12 WHEN N'signature' THEN 18 WHEN N'grand' THEN 10 ELSE 0 END
    THROW 51102, 'Invalid bouquet size.', 1;
  IF @Preferences IS NULL OR ISJSON(@Preferences) <> 1 OR DATALENGTH(@Preferences) > 16000
    THROW 51102, 'Invalid preferences.', 1;
  IF @CustomerName IS NULL OR LEN(TRIM(@CustomerName)) = 0 OR DATALENGTH(@CustomerName) > 240
    OR @RecipientName IS NULL OR LEN(TRIM(@RecipientName)) = 0 OR DATALENGTH(@RecipientName) > 240
    OR @DeliveryAddress IS NULL OR LEN(TRIM(@DeliveryAddress)) = 0 OR DATALENGTH(@DeliveryAddress) > 1000
    OR @Email IS NULL OR DATALENGTH(@Email) > 508 OR @Email NOT LIKE N'%_@_%._%'
    OR @Email LIKE N'% %' OR CHARINDEX(CHAR(10), @Email) > 0 OR CHARINDEX(CHAR(13), @Email) > 0
    OR @CardMessage IS NULL OR DATALENGTH(@CardMessage) > 1000
    THROW 51102, 'Invalid contact or delivery details.', 1;
  DECLARE @Date date = TRY_CONVERT(date, @DeliveryDate, 23);
  IF @Date IS NULL OR DATALENGTH(@DeliveryDate) <> 20 OR CONVERT(nvarchar(10), @Date, 23) <> @DeliveryDate
    THROW 51102, 'Use an ISO delivery date.', 1;

  -- JSON preserves field boundaries in the idempotency fingerprint.
  DECLARE @Payload nvarchar(max) = (SELECT @DesignId AS DesignId, @Size AS Size,
    @Preferences AS Preferences, @CustomerName AS CustomerName, @Email AS Email,
    @RecipientName AS RecipientName, @DeliveryAddress AS DeliveryAddress,
    @DeliveryDate AS DeliveryDate, @CardMessage AS CardMessage
    FOR JSON PATH, WITHOUT_ARRAY_WRAPPER);
  DECLARE @Hash binary(32) = HASHBYTES('SHA2_256', @Payload);
  DECLARE @Id uniqueidentifier, @ExistingHash binary(32), @LockResult int;
  DECLARE @Units int = CASE @Size WHEN N'petite' THEN 1 WHEN N'signature' THEN 2 ELSE 3 END;
  DECLARE @Name nvarchar(120);
  BEGIN TRY
    BEGIN TRANSACTION;
    -- One lock covers recipes sharing stems and payload-identical retries.
    -- Operators must take this lock too when adjusting recipes or stock.
    EXEC @LockResult = sys.sp_getapplock @Resource = N'Gulnara.Inventory',
      @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 10000;
    IF @LockResult < 0 THROW 51103, 'Inventory is busy. Retry the same request.', 1;
    SELECT @Id = Id, @ExistingHash = RequestHash FROM dbo.Bookings
      WHERE OwnerId = @OwnerId AND RequestId = @RequestId;
    IF @Id IS NOT NULL
    BEGIN
      IF @ExistingHash <> @Hash THROW 51104, 'Request ID was already used with different details.', 1;
      COMMIT TRANSACTION;
      SELECT Id, DesignName, Size, DeliveryDate, RecipientName, DeliveryAddress, Status, CreatedAt
        FROM api.Bookings WHERE Id = @Id;
      RETURN;
    END;
    DECLARE @Today date = CONVERT(date, SYSUTCDATETIME() AT TIME ZONE 'UTC' AT TIME ZONE 'Pacific Standard Time');
    IF @Date <= @Today OR @Date > DATEADD(day, 90, @Today)
      THROW 51102, 'Requested date is outside the request window.', 1;
    SELECT @Name = Name FROM dbo.Designs WITH (UPDLOCK, HOLDLOCK)
      WHERE Id = @DesignId AND IsPublished = 1 AND IsSample = 0;
    IF @Name IS NULL OR NOT EXISTS (SELECT 1 FROM dbo.DesignStems WHERE DesignId = @DesignId)
      THROW 51105, 'This design is not bookable.', 1;
    IF EXISTS (SELECT 1 FROM dbo.DesignStems r
      JOIN dbo.Flowers f WITH (UPDLOCK, HOLDLOCK) ON f.Id = r.FlowerId
      WHERE r.DesignId = @DesignId AND f.AvailableStems < r.StemsPerUnit * @Units)
      THROW 51106, 'There are not enough configured stems.', 1;
    SET @Id = NEWID();
    INSERT dbo.Bookings (Id, OwnerId, RequestId, RequestHash, DesignId, DesignName,
      Size, Preferences, CustomerName, Email, RecipientName, DeliveryAddress, DeliveryDate, CardMessage)
      VALUES (@Id, @OwnerId, @RequestId, @Hash, @DesignId, @Name,
        @Size, @Preferences, TRIM(@CustomerName), TRIM(@Email), TRIM(@RecipientName),
        TRIM(@DeliveryAddress), @Date, @CardMessage);
    INSERT dbo.BookingStems (BookingId, FlowerId, ReservedStems)
      SELECT @Id, FlowerId, StemsPerUnit * @Units FROM dbo.DesignStems WHERE DesignId = @DesignId;
    UPDATE f SET AvailableStems = f.AvailableStems - b.ReservedStems
      FROM dbo.Flowers f JOIN dbo.BookingStems b ON b.FlowerId = f.Id WHERE b.BookingId = @Id;
    COMMIT TRANSACTION;
    SELECT Id, DesignName, Size, DeliveryDate, RecipientName, DeliveryAddress, Status, CreatedAt
      FROM api.Bookings WHERE Id = @Id;
  END TRY
  BEGIN CATCH
    IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
    THROW;
  END CATCH;
END;
GO
INSERT dbo.SchemaVersions(Version, Checksum) VALUES (2, '$(MigrationHash)');
COMMIT TRANSACTION;
