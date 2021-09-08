import { INWCConnectionInfo, INWCDataSource, INWCTenantInfo } from 'nwc-sdk'
import { INWCDeployedWorkflow } from './INWCDeployedWorkflow'

export interface INWCPackageDeploymentOutcome {
	tenant: INWCTenantInfo
	connections: INWCConnectionInfo[]
	datasources: INWCDataSource[]
	deployedWorkflows: INWCDeployedWorkflow[]
	completed: boolean
}
