import { INWCPackageWorkflow } from "./INWCPackageWorkflow";
import {INWCTenantInfo} from "nwc-sdk"
import { INWCPackageWorkflowConnector } from "./INWCPackageWorkflowConnector";
export interface INWCPackage {
    key: string
    workflows: INWCPackageWorkflow[]
    connectors: INWCPackageWorkflowConnector[]
    sourceTenantInfo: INWCTenantInfo
}


