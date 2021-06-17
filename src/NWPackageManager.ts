import { readFileSync, writeFileSync } from "fs";
import {INWCTenantConnectionInfo, NWCTenant, INWCWorkflowSource, INWCWorkflowAction, INWCConnectionInfo, INWCWorkflowPublishPayload } from "nwc-sdk"
import { INWCPackage } from "./model/INWCPackage";
import { INWCPackageDeploymentOutcome } from "./model/INWCPackageDeploymentOutcome";
import { INWCPackageWorkflow } from "./model/INWCPackageWorkflow";
import { INWCPackageWorkflowConnector } from "./model/INWCPackageWorkflowConnector";
import { ILogging, LogWithStyle } from "ntx-utils"
import * as path from "path";

interface IWorkflowDependency {
    workflowId: string, 
    workflowName: string, 
    referencedWorkflowId: string, 
    referencedWorkflowName: string,
    key: string
}

export class NWCPackageManager implements ILogging {
    public package: INWCPackage;
    public tenant: NWCTenant;
    log: LogWithStyle;

    public constructor(packageKey?: string, existingPackage?: INWCPackage) {
        this.package = (existingPackage === undefined || existingPackage == null) ? {} as INWCPackage : existingPackage;
        
        if ((!this.package.key) && (packageKey)) {
            this.package.key = packageKey;
        }
        
        if (!this.package.connectors) {
            this.package.connectors = [] as INWCPackageWorkflowConnector[];
        }
        
        if (!this.package.workflows) {
            this.package.workflows = [] as INWCPackageWorkflow[];
        }

        this.tenant = new NWCTenant();
        this.log = new LogWithStyle();
    }

    public setLogging(logToConsole: boolean, logApiCalls : boolean = false) {
        this.tenant.setLogging(logApiCalls);
        this.log.logToConsole = logToConsole;
    }

    public async connect(connectionInfo: INWCTenantConnectionInfo) {
        await this.tenant.connect(connectionInfo);
    }

    public static loadPackage(path?:string) : INWCPackage {
        if (!path) path = './';
        return JSON.parse(readFileSync(path, 'utf8')) as INWCPackage;
    }

    public savePackage(path?:string) {
        if (!path) path = './';
        writeFileSync(`${this.package.key}.json`, JSON.stringify(this.package));
    }

    public async buildPackage(skipExports: boolean = false, saveWorkflowsFolderPath?: string) {
        this.log.writeStart(`Packaging ${this.package.key} from tenant ${this.tenant.tenantInfo.name}`);
        const allWorkflows = await this.getAllPackageWorkflows();
        await this.packageWorkflows(allWorkflows, skipExports);
        await this.packageConnectors(allWorkflows);
        this.package.sourceTenantInfo = this.tenant.tenantInfo;
        if (saveWorkflowsFolderPath) {
            this.log.writeStart(`Saving workflow sources to folder ${saveWorkflowsFolderPath}`);
            for (const source of allWorkflows) {
                this.log.write(`Saving workflow ${source.workflowName}`);
                writeFileSync(path.join(saveWorkflowsFolderPath, `${source.workflowName}.json`), JSON.stringify(source));
            }
            this.log.writeSuccess(`All workflows saved to folder ${saveWorkflowsFolderPath}`);
        }
        this.log.writeSuccess(`Packaging of ${this.package.key} from tenant ${this.tenant.tenantInfo.name} completed.`);
    }

    public async obliterate() {
        this.log.writeWarning(`WARNING! YOU ARE DELETING ALL ${this.package.key} WORKFLOWS FROM TENANT ${this.tenant.tenantInfo.name}`);        
        for (const workflow of this.package.workflows) {
            this.log.write(`Deleting ${workflow.workflowName}`);        
            const exists = await this.tenant.checkIfWorkflowExists(workflow.workflowName);
            if (exists) {
                const workflowOnTenant = this.tenant.workflows.find(w => {return w.name === workflow.workflowName})!
                await this.tenant.deleteWorkflowSource(workflowOnTenant.id);
                this.log.writeSuccess(`${workflow.workflowName} deleted.`);        
            } else {
                this.log.write(`${workflow.workflowName} not found on tenant`); 
            }
        } 
        this.log.writeSuccess(`Solution ${this.package.key} deleted from ${this.tenant.tenantInfo.name}`);
    }

    private async getAllPackageWorkflows() : Promise<INWCWorkflowSource[]> {
        const sources = [] as INWCWorkflowSource[];
        this.log.write(`Identifying solution workfows`);        
        const solutionWorkflows = this.tenant.workflows.filter(wf => {
            return wf.tags?.some((tag: { name: any; }) => {
                return (tag.name === this.package.key);
            });
        });
        
        for (const solutionWorkflow of solutionWorkflows) {
            this.log.write(`Retrieving workfow ${solutionWorkflow.name}`);        
            const source = await this.tenant.getWorkflowSource(solutionWorkflow.id);
            sources.push(source);
        }
        return sources;
    }

    public getFlatActionsArray(action : INWCWorkflowAction, allActions? : INWCWorkflowAction[]) : INWCWorkflowAction[] {
        if (allActions === null || allActions === undefined) {
            allActions = [] as INWCWorkflowAction[];
        }
        allActions.push(action);
        if (action.next) {
            this.getFlatActionsArray(action.next, allActions)
        }
        action.children.forEach(a => this.getFlatActionsArray(a, allActions))
        return allActions;
    }

    public packageConnectors(sources : INWCWorkflowSource[]) {
        sources.forEach(source => {
            const allActions = this.getFlatActionsArray(source.workflowDefinitionAsObject!.actions);
            for (let contractId in source.workflowDefinitionAsObject!.inUseXtensions) {
                const resolvedContractId = ((source.workflowDefinitionAsObject!.inUseXtensions[contractId].xtension['x-ntx-contract-id'] !== null && source.workflowDefinitionAsObject!.inUseXtensions[contractId].xtension['x-ntx-contract-id'] !== undefined) ? contractId : source.workflowDefinitionAsObject!.inUseXtensions[contractId].xtension['x-ntx-contract-id']) as string;
                const actionUsingConnectorId = source.workflowDefinitionAsObject!.inUseXtensions[contractId].usedByActionIds[0];
                const action = allActions.find(a=>a.id === actionUsingConnectorId)!;
                let connectionId : string | undefined;
                for (const property of action.configuration.properties) {
                    let foundConnection = property.parameters.find(parameter => parameter.name === "['X_NTX_XTENSION_INPUT']");
                    if (foundConnection) {
                        let key = foundConnection.value.primitiveValue!.valueType.data.value.schema.required.find((p: string) => p.includes(".path."));
                        if (key) {
                            const connectionConfig = foundConnection.value.primitiveValue!.valueType.data.value.value[key];
                            connectionId = connectionConfig.literal;
                        }
                    }
                }
                const foundConnector = this.package.connectors.find(cn => cn.id === resolvedContractId);
                if (!foundConnector) {
                    this.package.connectors.push( { id: resolvedContractId, name: source.workflowDefinitionAsObject!.inUseXtensions[contractId].xtension.info.title, connectionId: connectionId });
                }
            }

            /* Exception handling for Nintex Sign */
            /* ISSUE: Nintex Sign connector does not exist in the inUseExtensions of the workflow definition */
            /* WORKAROUND: Look for actions classnames that start with 'composite' and figure out the connector; */
            
            allActions.filter(action => { return action.className.startsWith('composite') })
                    .map(action => { return action.className.split(':')[1];})
                    .filter((action, index, array) => array.indexOf(action) === index)
                    .forEach(actionClassName => {
                        const connector = this.tenant.connectors.find(connector => {
                            return connector.actions.find(action => action.type == actionClassName )
                        });
                        if (!connector) {
                            throw new Error('No connector matched for class name: ' + actionClassName);
                        }
                        const foundConnector = this.package.connectors.find(cn => cn.id === connector.id);
                        if (!foundConnector) {
                            this.package.connectors.push( { id: connector.id, name: connector.name });
                        }
                });
        });
    }

    private getComponentWorkflowId(action: INWCWorkflowAction) : string | undefined {
        return action.configuration.properties.find(property => {return (property.parameters.find(parameter => {return parameter.name === "wfId";}))})
            ?.parameters.find(parameter => {return parameter.name === "wfId";})?.value.primitiveValue?.valueType.data.value;
    }

    private safeFindInSorted(sorted: string[], name: string) : boolean {
        for(var i = 0; i < sorted.length; i++) {
            if (sorted[i] === name) {
                return true;
            }
        }
        return false;
    }

    private processDependencies(dependencies:IWorkflowDependency[], workflowName :string, sorted: string[]) {
        if (this.safeFindInSorted(sorted, workflowName)) {
            return;
        }
        const workflowDependencies = dependencies.filter(d => {return d.workflowName == workflowName});
        workflowDependencies.forEach(workflowDependency => {
            const found = dependencies.find(d=>{return d.workflowName == workflowDependency.referencedWorkflowName});
            if (found) {
                this.processDependencies(dependencies, workflowDependency.referencedWorkflowName, sorted);
            } else {
                if (!this.safeFindInSorted(sorted, workflowDependency.referencedWorkflowName)) {
                    sorted.push(workflowDependency.referencedWorkflowName);
                }
            }
        });
        
        if (!this.safeFindInSorted(sorted, workflowName)) {
            sorted.push(workflowName);
        }
    }
    private resolveWorkflowDeploymentOrder(dependencies: IWorkflowDependency[]) : string[] {
        const sorted = [] as string[];
        const names = dependencies.map(dependency => {return dependency.workflowName}).filter((value, index, self) => {return self.indexOf(value) === index});        
        dependencies.forEach(dependency => {
            this.processDependencies(dependencies, dependency.workflowName, sorted);
        });
        return sorted;
    } 

    private async packageWorkflows(sources : INWCWorkflowSource[], skipExports:boolean = false) : Promise<void> {
        this.log.writeStart(`Identifying dependencies`);
        const dependencies = this.identifyWorklowDependencies(sources);
        const deployOrder = this.resolveWorkflowDeploymentOrder(dependencies);
        let order = 1;
        for(var i = 0; i <deployOrder.length; i++) {
            
            const workflow = sources.find(w=> {return w.workflowName === deployOrder[i]});
            const solutionWorkflow = {} as INWCPackageWorkflow; 
            solutionWorkflow.workflowName = workflow!.workflowName;
            solutionWorkflow.workflowId = workflow!.workflowId;
            solutionWorkflow.order = order;
            const workflowInfo = this.tenant.workflows.find(w => {return w.id === workflow!.workflowId})!;
            if (!skipExports) {
                solutionWorkflow.exportKey = await this.tenant.exportWorkflow(workflow!.workflowId);
            } else {
                solutionWorkflow.exportKey = "not exported";
            }
            order++;
            if (workflow!.startEvents?.length > 0 && (workflow!.startEvents[0].xtensionEventConfiguration)) {
                solutionWorkflow.eventManagerSubscription = workflow!.startEvents[0].xtensionEventConfiguration.eventManagerSubscription;
            }
            this.package.workflows.push(solutionWorkflow);
        }
    }

    private identifyWorklowDependencies(sources: INWCWorkflowSource[]) : IWorkflowDependency[] {
        const dependencies = [] as IWorkflowDependency[];
        for(const source of sources) {
            const componentWorkflowActions = this.getFlatActionsArray(source.workflowDefinitionAsObject!.actions).filter(action => {return action.className === "engine:startworkflow"});
            for(const action of componentWorkflowActions) {
                const referencedWorkflowId = this.getComponentWorkflowId(action);
                const referencedWorkflow = sources.find(referencedWorkflow => {return referencedWorkflow.workflowId === referencedWorkflowId;});        
                if (!referencedWorkflow) {
                    throw new Error("Error figuring out referenced workflow with Id: " + referencedWorkflowId + " for workflow " + source.workflowName);
                }
                const dependency = {
                    workflowId: source.workflowId, 
                    workflowName: source.workflowName, 
                    referencedWorkflowId: referencedWorkflow.workflowId, 
                    referencedWorkflowName: referencedWorkflow.workflowName,
                    key: `${source.workflowName}|${referencedWorkflow.workflowName}`
                } as IWorkflowDependency;

                if (!(dependencies.find(r => {return r.key === dependency.key}))){ 
                    dependencies.push(dependency)
                }
            };
        };
        return dependencies;
    }

    public async validateDeploymentTarget(connections: INWCConnectionInfo[], skipWorkflowExistsCheck: boolean = false) : Promise<boolean> {
        const foundConnections = [] as INWCConnectionInfo[];
        
        if (!this.canDeployToTenant()) {
            this.log.writeError(`Tenant ${this.tenant.tenantInfo.name} is not compatible.`);
            return false;
        }
        this.log.write(`Tenant ${this.tenant.tenantInfo.name} is compatible.`);
        connections.forEach(connection =>{ 
            const foundConnection = this.tenant.connections.find(cn => { return cn.id === connection.id && cn.isInvalid === false});
            if (foundConnection) {
                foundConnections.push(foundConnection);
            }
        });
        this.log.write(`Found ${foundConnections.length} connections against ${this.package.connectors.length} solution required connectors.`);
        if (foundConnections.length !== this.package.connectors.length) {
            this.log.writeError(`Only ${foundConnections.length} out of ${this.package.connectors.length} connections found on the tenant`);
            return false;
        }
        if (!skipWorkflowExistsCheck) {
            for (const packagedWorkflow of this.package.workflows) {
                const workflowExists = await this.tenant.checkIfWorkflowExists(packagedWorkflow.workflowName)
                if (workflowExists) {
                    this.log.writeError(`Workflow ${packagedWorkflow.workflowName} found on the tenant`);
                    return false;
                } else {
                    this.log.write(`Workflow ${packagedWorkflow.workflowName} does not exist and can be deployed`);
                }
            }
        }
        return true;
    }

    private canDeployToTenant(): boolean {
        return (this.tenant.tenantInfo.details.cloudElementService === this.package.sourceTenantInfo.details.cloudElementService);
    }

    public getMatchingConnectionInfos() : INWCConnectionInfo[] {
        const matchedConnectionInfo = [] as INWCConnectionInfo[]
        this.package.connectors.forEach(connector => {
            const matchedConnections = this.tenant.connections.filter(connection => {
                return connection.contractName == connector.name && (connection.isInvalid === false);
            });
            matchedConnectionInfo.push(...matchedConnections);
        });
        return matchedConnectionInfo;
    }

    public async deploy(connections: INWCConnectionInfo[], skipExisting: boolean = false) : Promise<INWCPackageDeploymentOutcome> {
        this.log.writeStart(`Validating tenant ${this.tenant.tenantInfo.name} for deployment`);
        if (skipExisting) {
            this.log.writeWarning(`skipExisting was specified. The process will ignore existing workflows`);
        }
        if (!(await this.validateDeploymentTarget(connections, skipExisting))) {
            throw new Error("Preflight validation failed. Check that you are providing the correct connections and that the tenant is compatible with the solution");
        }
        this.log.writeSuccess(`Validation complete.`);
        const outcome = { 
            tenant : this.tenant.tenantInfo,
            connections : connections,
            deployedWorkflows : [],
            completed: false
        } as INWCPackageDeploymentOutcome
        
        this.log.writeStart(`Starting deployment on tenant ${this.tenant.tenantInfo.name}`);
        for(const packageWorkflow of this.package.workflows) {
            this.log.write(`Importing workflow ${packageWorkflow.workflowName}`);
            const importWorkflow = skipExisting 
                ? !(await this.tenant.checkIfWorkflowExists(packageWorkflow.workflowName))
                : true;
            
            if (!importWorkflow) {
                this.log.writeWarning(`Skipping workflow ${packageWorkflow.workflowName}`);
                continue;
            }
            const importedWorkflow = await this.tenant.importWorkflow(packageWorkflow.exportKey, packageWorkflow.workflowName)
            this.log.write(`Getting source for ${packageWorkflow.workflowName}`);
            const source = await this.tenant.getWorkflowSource(importedWorkflow.workflowId.workflowId);
            this.log.write(`Updating definition for ${packageWorkflow.workflowName}`);
            this.updateWorkflowSource(source, outcome);
            this.log.write(`Publishing ${packageWorkflow.workflowName}`);
            try {
                const publishedSource = await this.publishWorkflow(source);
                const publishedWorkflowInfo = await this.tenant.getWorkflow(source.workflowId);
                if (publishedWorkflowInfo) {
                    this.log.writeSuccess(`Workflow ${packageWorkflow.workflowName} published`);
                } else {
                    this.log.writeError(`Publishing of workflow ${packageWorkflow.workflowName} failed`);
                }
                outcome.deployedWorkflows.push( {deployed: publishedWorkflowInfo, packaged: packageWorkflow});
            } catch (Error) {
                outcome.deployedWorkflows.push( {packaged: packageWorkflow, publishingErrorSource: source});
                this.log.writeError(`Workflow ${packageWorkflow.workflowName} failed to deploy.`);
                return outcome;        
            }
        }
        this.log.writeSuccess(`Workflows deployed on tenant ${this.tenant.tenantInfo.name}`);
        return outcome;
    }

    public async publishWorkflow(source: INWCWorkflowSource) : Promise<INWCWorkflowSource> {
        const payload = this.createPublishPayload(source);
        return this.tenant.publishWorkflow(source.workflowId, payload);
    }

    public ensureCorrectRegion(source: INWCWorkflowSource) {
        let definitionAsString = JSON.stringify(source.workflowDefinitionAsObject);
        definitionAsString = this.regionaliseString(definitionAsString);
        source.workflowDefinitionAsObject = JSON.parse(definitionAsString);
    }
    
    public regionaliseString(value: string) : string {
        let regionalisedString = value.split(`/${this.package.sourceTenantInfo.details.serviceRegion}/`).join(`/${this.tenant.tenantInfo.details.serviceRegion}/`);
        regionalisedString = regionalisedString.split(`${this.package.sourceTenantInfo.details.serviceRegion}-`).join(`${this.tenant.tenantInfo.details.serviceRegion}-`);
        regionalisedString = regionalisedString.split(this.package.sourceTenantInfo.host).join(this.tenant.tenantInfo.host);
        return regionalisedString;
    }

    public updateWorkflowSource(source: INWCWorkflowSource, deployment: INWCPackageDeploymentOutcome) {
        // Set author to current user
        source.workflowDefinitionAsObject!.settings.author = this.tenant.currentUser;

        // Update actions
        var actions = this.getFlatActionsArray(source.workflowDefinitionAsObject!.actions);
        for(const action of actions) {
            // Xtensions
            if (action.className.startsWith('xtension')) {
                for (const property of action.configuration.properties) {
                    let foundConnection = property.parameters.find(parameter => parameter.name === "['X_NTX_XTENSION_INPUT']");
                    if (foundConnection) {
                        let key = foundConnection.value.primitiveValue!.valueType.data.value.schema.required.find((p: string) => p.includes(".path."));
                        if (key) {
                            const connectionConfig = foundConnection.value.primitiveValue!.valueType.data.value.value[key];
                            const targetConnection = deployment.connections.find(cn => cn.contractName === connectionConfig.data.contractName)!;
                            connectionConfig.literal = targetConnection.id;
                            connectionConfig.data = targetConnection;
                        }
                    }
                }
            }
            
            // Nintex Sign Action
            if (action.className === "composite:nintexsign-get-signature") {
                for (const property of action.configuration.properties) {
                    let foundConnectionIdParameter = property.parameters.find(parameter => parameter.name === "connectionId");
                    if (foundConnectionIdParameter) {
                        const targetConnection = deployment.connections.find(cn => cn.contractName === "Nintex Sign powered by Adobe Sign")!;
                        if (targetConnection) {
                            foundConnectionIdParameter.value.primitiveValue!.valueType.data.value = targetConnection.id;
                        }
                    }
                }
            }

            // Generate Document Action
            if (action.className === "async-action:drawloop-generate-document-v2") {
                for (const property of action.configuration.properties) {
                    let foundConnectionIdParameter = property.parameters.find(parameter => parameter.name === "templateConnectionId");
                    if (foundConnectionIdParameter) {
                        const sourceConnectionId = foundConnectionIdParameter.value.primitiveValue!.valueType.data.value;
                        const sourceConnection = this.package.connectors.find(cn => cn.connectionId === sourceConnectionId)!;
                        const targetConnection = deployment.connections.find(cn => cn.contractName === sourceConnection.name)!;
                        if (targetConnection) {
                            foundConnectionIdParameter.value.primitiveValue!.valueType.data.value = targetConnection.id;
                        }
                    }
                }
            }
            
            // Composite workflow references
            if (action.className === "engine:startworkflow") {
                for (const property of action.configuration.properties) {
                    const foundWorkflowIdParameter = property.parameters.find(parameter => parameter.name === "wfId");
                    if (foundWorkflowIdParameter) {
                        const existingWorkflowId = foundWorkflowIdParameter.value.primitiveValue!.valueType.data.value;
                        const deployedWorkflow = deployment.deployedWorkflows.find(dw => {
                            return dw.packaged.workflowId === existingWorkflowId
                        });
                        if (deployedWorkflow) {
                            foundWorkflowIdParameter.value.primitiveValue!.valueType.data.value = deployedWorkflow.deployed!.id;
                        }
                    }
                }
            }
        }

        // Start events
        const packagedWorkflow = this.package.workflows.find(w => {return w.workflowName == source.workflowName})!
        
        // TODO: Only supporting a single Salesforce start event for now.
        const startEvent = source.startEvents[0]
        if (startEvent.eventType.startsWith('xtension')) {
            const targetConnection = deployment.connections.find(cn => cn.contractName === startEvent.eventGroup)!;
            for (var key in startEvent.xtensionEventConfiguration.inputValue) {
                if (key.includes(".path.NTX_CONNECTION_ID")) {
                    startEvent.xtensionEventConfiguration.inputValue[key] = targetConnection.id;
                }
            }

            if (packagedWorkflow.eventManagerSubscription) {
                const sourceConnectionId = packagedWorkflow.eventManagerSubscription.connectionId;
                const sourceSubscriptionUrl = packagedWorkflow.eventManagerSubscription.subscribe.url;
                const targetSubscriptionUrl = sourceSubscriptionUrl.replace(this.package.sourceTenantInfo.host, this.tenant.tenantInfo.host)
                packagedWorkflow.eventManagerSubscription.connectionId = targetConnection.id;
                packagedWorkflow.eventManagerSubscription.subscribe.url = this.regionaliseString(targetSubscriptionUrl).replace(sourceConnectionId, targetConnection.id);
                startEvent.xtensionEventConfiguration.eventManagerSubscription = packagedWorkflow.eventManagerSubscription;
            } 
        }

        // Ensure that the source targets the correct region
        this.ensureCorrectRegion(source);
        source.workflowDefinition = JSON.stringify(source.workflowDefinitionAsObject);
    }
    
    public createPublishPayload(source: INWCWorkflowSource) : INWCWorkflowPublishPayload {
        const payload = {} as INWCWorkflowPublishPayload;
        payload.workflowName = source.workflowName;
        payload.workflowDescription = source.workflowDescription;
        payload.workflowType = "Production";
        payload.workflowDefinition = source.workflowDefinition;
        payload.author = source.author;
        payload.startEvents = source.startEvents;
        payload.datasources = source.datasources;
        payload.permissions = source.permissions;
        payload.workflowVersionComments = source.workflowVersionComments;
        payload.workflowVersionComments = "Published";
        payload.workflowDesignParentVersion = source.workflowDesignVersion;
        payload.tags = source.tags;
        payload.version = source.version;
        return payload;
    }
}
