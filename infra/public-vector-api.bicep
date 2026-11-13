param apiName string = 'gulnara-vector-demo-61868ab8'
param location string = 'eastus'
resource plan 'Microsoft.Web/serverfarms@2024-11-01' = {
  name: 'gulnara-public-api-f1'
  location: location
  tags: { 'sqlapps-version': '0.3.1' }
  kind: 'linux'
  sku: { name: 'F1', tier: 'Free', capacity: 1 }
  properties: { reserved: true }
}
resource api 'Microsoft.Web/sites@2024-11-01' = {
  name: apiName
  location: location
  tags: { 'sqlapps-version': '0.3.1' }
  kind: 'app,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|22-lts'
      appCommandLine: 'node server.mjs'
      alwaysOn: false
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
    }
  }
}
output apiHostname string = api.properties.defaultHostName
output principalId string = api.identity.principalId
output outboundIps string = api.properties.outboundIpAddresses
