using './main.bicep'

param workload = 'gulnara'
param nameSuffix = '6257ab'
param location = 'eastus'
param sqlLocation = 'eastus'
// SQL defaults to hosting region. Override sqlLocation only for a separately approved NEW SQL target.
param sqlappsVersion = '0.3.1'
// Supply approved immutable webImage and dabImage digests before deployment.
// Optional private registry hostname; separately approve the registry cost and managed-identity pull grant.
param privateRegistryServer = ''
// Supply approved OIDC and Entra administrator values before deployment.
// Default denies SQL connectivity. Enable only after the documented access approval.
param allowAzureServices = false
param operatorIpAddress = ''
param runtimeIpAllowlist = []
param ownerTag = ''
param createdByTag = ''
param additionalTags = {}
// Both staged authorization gates remain closed until the documented review and readback steps.
param serverStageAuthorized = false
param databaseStageAuthorized = false
param enableSqlDefenderOptOut = false
// Enable only after SQL migrations, managed identity grants and network access are ready.
param deployApplications = false
