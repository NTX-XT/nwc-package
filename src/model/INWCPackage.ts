import { INWCPackageWorkflow } from './INWCPackageWorkflow'
import { INWCTenantInfo } from 'nwc-sdk'
import { INWCPackageWorkflowConnector } from './INWCPackageWorkflowConnector'
import { INWCPackageWorkflowDatasource } from './INWCPackageWorkflowDatasource'
export interface INWCPackage {
	key: string
	workflows: INWCPackageWorkflow[]
	connectors: INWCPackageWorkflowConnector[]
	datasources: INWCPackageWorkflowDatasource[]
	sourceTenantInfo: INWCTenantInfo
}
