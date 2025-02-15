import type {
  AmplicationPlugin,
  CreateServerParams,
  DsgContext,
  Events,
  ModuleMap,
} from "@amplication/code-gen-types";
import { EventNames } from "@amplication/code-gen-types";
import { resolve } from "path";
import { kebabCase, snakeCase } from "lodash";
import { getTerraformDirectory, getPluginSettings } from "./utils";
import {
  environmentKey,
  nameKey,
  regionKey,
  moduleNameKey,
  zoneSuffixKey,
  tierKey,
  databaseCharsetKey,
  databaseCollationKey,
  diskSizeKey,
  diskTypekey,
  availabilityTypeKey,
  deletionProtectionKey,
  versionKey,
  teamKey,
} from "./constants";

class TerraformAwsDatabaseCloudSql implements AmplicationPlugin {
  register(): Events {
    return {
      [EventNames.CreateServer]: {
        after: this.afterCreateServer,
      },
    };
  }
  async afterCreateServer(
    context: DsgContext,
    eventParams: CreateServerParams,
    modules: ModuleMap
  ): Promise<ModuleMap> {
    context.logger.info(`Generating Terraform GCP Database Cloud SQL...`);

    // get the name for the service, to be used as a fallback for the
    // repository name
    const serviceName = kebabCase(context.resourceInfo?.name);
    if (!serviceName) {
      throw new Error(
        "TerraformAwsDatabaseCloudSql: Service name is undefined"
      );
    }

    // instantiate a variable consisting of the path on the
    // 'provisioning-terraform-gcp-core' made up of the settings
    // 'root_directory' & 'directory_name', this function will throw
    // an error if the aforementioned plugin wasnt installed.
    const terraformDirectory = getTerraformDirectory(
      context.pluginInstallations,
      context.serverDirectories.baseDirectory
    );

    // fetch the plugin specific settings and merge them with the defaults
    const settings = getPluginSettings(context.pluginInstallations);

    const templateFileName: string = "csql-template.tf";
    const fileNamePrefix: string = "csql-";
    const fileNameSuffix: string = ".tf";
    const name: string = settings.global.name
      ? settings.global.name
      : serviceName;

    const staticPath = resolve(
      __dirname,
      "./static/" + settings.configuration.type
    );

    const staticFiles = await context.utils.importStaticModules(
      staticPath,
      terraformDirectory
    );

    staticFiles.replaceModulesPath((path) =>
      path.replace(templateFileName, fileNamePrefix + name + fileNameSuffix)
    );

    staticFiles.replaceModulesCode((_path, code) =>
      code
        .replaceAll(nameKey, kebabCase(name))
        .replaceAll(moduleNameKey, "csql_" + snakeCase(name))
        .replaceAll(environmentKey, settings.global.environment)
        .replaceAll(teamKey, settings.global.team)
        .replaceAll(regionKey, settings.global.region)
        .replaceAll(zoneSuffixKey, settings.global.zone_suffix)
        .replaceAll(tierKey, settings.global.tier)
        .replaceAll(databaseCharsetKey, settings.global.charset)
        .replaceAll(databaseCollationKey, settings.global.collation)
        .replaceAll(diskSizeKey, settings.global.disk_size)
        .replaceAll(diskTypekey, settings.global.disk_type)
        .replaceAll(availabilityTypeKey, settings.global.availability_type)
        .replaceAll(deletionProtectionKey, settings.global.deletion_protection)
        .replaceAll(versionKey, settings.global.version)
    );

    context.logger.info(`Generated Terraform GCP Database Cloud SQL...`);

    await modules.merge(staticFiles);
    return modules;
  }
}

export default TerraformAwsDatabaseCloudSql;
