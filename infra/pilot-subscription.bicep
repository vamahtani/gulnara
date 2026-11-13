targetScope = 'subscription'

@description('Exact approved pilot environment name.')
param environmentName string = 'gulnara-pilot-6257'

@description('Exact approved isolated resource group name.')
param resourceGroupName string = 'rg-gulnara-pilot-6257'

param location string = 'eastus'
param sessionId string = 'REPLACE_SESSION_ID'

@description('Deployment operator display name, supplied at deployment review time.')
param deployedBy string

@description('ISO 8601 creation timestamp, supplied at deployment review time.')
param createdAt string

@description('Approved resource owner tag.')
param ownerTag string

@description('Approved resource creator tag.')
param createdByTag string

@description('No SQL/database/apps are created by default in the pilot wrapper.')
param serverStageAuthorized bool = false

param databaseStageAuthorized bool = false

param deployApplications bool = false
param enableSqlDefenderOptOut bool = false
param createPullToken bool = false

param workload string = 'gulnara'
param nameSuffix string = '6257ab'
param sqlLocation string = 'eastus'

param webImage string
param dabImage string
param privateRegistryServer string = ''
param privateRegistryUsername string = ''

@secure()
param privateRegistryPassword string = ''

param authAuthority string
param authIssuer string
param authAudience string
param authClientId string
param authScope string
param sqlAdministratorName string
param sqlAdministratorObjectId string

@allowed([
  'Group'
  'User'
])
param sqlAdministratorType string = 'Group'

param allowAzureServices bool = false
param operatorIpAddress string = ''
param runtimeIpAllowlist array = []
param additionalTags object = {}
param registryName string = 'crgulnarapilot6257'

var baseTags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
  Owner: ownerTag
  CreatedBy: createdByTag
}

// Keep caller-supplied tags, but enforce the approved version last.
var tags = union(additionalTags, baseTags, {
  'sqlapps-version': '0.3.1'
})

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' = {
  name: resourceGroupName
  location: location
  tags: tags
}

module application './main.bicep' = {
  name: 'gulnara-application'
  scope: rg
  params: {
    workload: workload
    nameSuffix: nameSuffix
    location: location
    sqlLocation: sqlLocation
    sqlappsVersion: '0.3.1'
    webImage: webImage
    dabImage: dabImage
    privateRegistryServer: privateRegistryServer
    privateRegistryUsername: privateRegistryUsername
    privateRegistryPassword: privateRegistryPassword
    authAuthority: authAuthority
    authIssuer: authIssuer
    authAudience: authAudience
    authClientId: authClientId
    authScope: authScope
    sqlAdministratorName: sqlAdministratorName
    sqlAdministratorObjectId: sqlAdministratorObjectId
    sqlAdministratorType: sqlAdministratorType
    allowAzureServices: allowAzureServices
    operatorIpAddress: operatorIpAddress
    runtimeIpAllowlist: runtimeIpAllowlist
    deployApplications: deployApplications
    serverStageAuthorized: serverStageAuthorized
    databaseStageAuthorized: databaseStageAuthorized
    enableSqlDefenderOptOut: enableSqlDefenderOptOut
    ownerTag: ownerTag
    createdByTag: createdByTag
    additionalTags: tags
  }
}

module registry './pilot.bicep' = {
  name: 'gulnara-registry'
  scope: rg
  params: {
    registryName: registryName
    location: location
    tags: tags
    createPullToken: createPullToken
  }
}

output resourceGroupId string = rg.id
output registryId string = registry.outputs.registryId
