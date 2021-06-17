import { INWCConnectionInfo, INWCTenantInfo } from "nwc-sdk";
import { INWCDeployedWorkflow } from "./INWCDeployedWorkflow";


export interface INWCPackageDeploymentOutcome {
    tenant: INWCTenantInfo;
    connections: INWCConnectionInfo[];
    deployedWorkflows: INWCDeployedWorkflow[];
    completed: boolean;
}
