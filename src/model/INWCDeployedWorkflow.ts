import { INWCWorkflowInfo, INWCWorkflowSource } from 'nwc-sdk'
import { INWCPackageWorkflow } from './INWCPackageWorkflow'

export interface INWCDeployedWorkflow {
	packaged: INWCPackageWorkflow
	deployed?: INWCWorkflowInfo
	publishingErrorSource?: INWCWorkflowSource
	publishedSource?: INWCWorkflowSource
}
