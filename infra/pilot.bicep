targetScope = 'resourceGroup'

@description('Approved private registry name for the Gulnara pilot.')
param registryName string = 'crgulnarapilot6257'

param location string = resourceGroup().location

@description('Merged tags from the subscription wrapper. sqlapps-version is enforced by this module.')
param tags object

@description('Optional separately approved repository-scoped read-only token. Disabled by default.')
param createPullToken bool = false

param pullScopeMapName string = 'gulnara-read'
param pullTokenName string = 'gulnara-pull'

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: registryName
  location: location
  tags: union(tags, {
    'sqlapps-version': '0.3.1'
  })
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource pullScopeMap 'Microsoft.ContainerRegistry/registries/scopeMaps@2025-11-01' = if (createPullToken) {
  parent: registry
  name: pullScopeMapName
  properties: {
    description: 'Read-only pull scope for the Gulnara web and DAB repositories.'
    actions: [
      'repositories/gulnara/web/content/read'
      'repositories/gulnara/web/metadata/read'
      'repositories/gulnara/dab/content/read'
      'repositories/gulnara/dab/metadata/read'
    ]
  }
}

resource pullToken 'Microsoft.ContainerRegistry/registries/tokens@2025-11-01' = if (createPullToken) {
  parent: registry
  name: pullTokenName
  properties: {
    scopeMapId: pullScopeMap.id
    status: 'enabled'
  }
}

output registryId string = registry.id
output loginServer string = registry.properties.loginServer
