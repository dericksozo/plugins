import {
  AmplicationPlugin,
  CreateEntityControllerBaseParams,
  CreateEntityControllerToManyRelationMethodsParams,
  CreateEntityModuleBaseParams,
  CreateEntityResolverBaseParams,
  CreateEntityResolverToManyRelationMethodsParams,
  CreateEntityResolverToOneRelationMethodsParams,
  CreateEntityServiceBaseParams,
  CreateEntityServiceParams,
  CreateServerDotEnvParams,
  CreateServerPackageJsonParams,
  DsgContext,
  EntityField,
  EnumEntityAction,
  Events,
  Module,
} from "@amplication/code-gen-types";
import { envVariables } from "./constants";
import { resolve } from "path";
import {
  createUserInfo,
  createTokenPayloadInterface,
  createAuthConstants,
  createTokenService,
  createTokenServiceTests,
  createGrantsModule,
  createDefaultGuard,
} from "./core";
import {
  addDecoratorsToClassDeclaration,
  addIdentifierToConstructorSuperCall,
  addImports,
  awaitExpression,
  getClassDeclarationById,
  importNames,
  interpolate,
  logicalExpression,
  memberExpression,
} from "./util/ast";
import { isPasswordField } from "./util/field";
import { builders, namedTypes } from "ast-types";
import { setAuthPermissions } from "./util/set-endpoint-permissions";
import {
  controllerMethodsIdsActionPairs,
  controllerToManyMethodsIdsActionPairs,
  resolverMethodsIdsActionPairs,
} from "./core/create-method-id-action-entity-map";
import { relativeImportPath } from "./util/module";
import { addInjectableDependency } from "./util/nestjs-code-generation";

const TO_MANY_MIXIN_ID = builders.identifier("Mixin");
const ARGS_ID = builders.identifier("args");
const PASSWORD_FIELD_ASYNC_METHODS = new Set(["create", "update"]);
const DATA_ID = builders.identifier("data");
const PASSWORD_SERVICE_ID = builders.identifier("PasswordService");
const PASSWORD_SERVICE_MEMBER_ID = builders.identifier("passwordService");
const HASH_MEMBER_EXPRESSION = memberExpression`this.${PASSWORD_SERVICE_MEMBER_ID}.hash`;
const TRANSFORM_STRING_FIELD_UPDATE_INPUT_ID = builders.identifier(
  "transformStringFieldUpdateInput"
);
class AuthCorePlugin implements AmplicationPlugin {
  register(): Events {
    return {
      CreateServerDotEnv: {
        before: this.beforeCreateServerDotEnv,
      },
      CreateServerPackageJson: {
        before: this.beforeCreateServerPackageJson,
        after: this.afterCreateServerPackageJson,
      },
      CreateServerAuth: {
        after: this.afterCreateServerAuth,
      },
      CreateEntityModuleBase: {
        before: this.beforeCreateEntityModuleBase,
      },
      CreateEntityControllerBase: {
        before: this.beforeCreateControllerBaseModule,
      },
      CreateEntityControllerToManyRelationMethods: {
        before: this.beforeCreateEntityControllerToManyRelationMethods,
      },
      CreateEntityResolverBase: {
        before: this.beforeCreateResolverBaseModule,
      },
      CreateEntityResolverToManyRelationMethods: {
        before: this.beforeCreateEntityResolverToManyRelationMethods,
      },
      CreateEntityResolverToOneRelationMethods: {
        before: this.beforeCreateEntityResolverToOneRelationMethods,
      },
      CreateEntityService: {
        before: this.beforeCreateEntityService,
      },
      CreateEntityServiceBase: {
        before: this.beforeCreateEntityServiceBase,
      },
    };
  }

  beforeCreateServerDotEnv(
    context: DsgContext,
    eventParams: CreateServerDotEnvParams
  ) {
    eventParams.envVariables = [...eventParams.envVariables, ...envVariables];

    return eventParams;
  }

  beforeCreateServerPackageJson(
    context: DsgContext,
    eventParams: CreateServerPackageJsonParams
  ) {
    context.utils.skipDefaultBehavior = true;
    return eventParams;
  }

  async afterCreateServerPackageJson(context: DsgContext) {
    const staticPath = resolve(__dirname, "../static/package-json");
    const staticsFiles = await AuthCorePlugin.getStaticFiles(
      context,
      context.serverDirectories.baseDirectory,
      staticPath
    );

    return staticsFiles;
  }

  async afterCreateServerAuth(context: DsgContext) {
    const staticPath = resolve(__dirname, "../static/auth");
    const interceptorsStaticPath = resolve(__dirname, "../static/interceptors");
    const staticsInterceptorsFiles = await AuthCorePlugin.getStaticFiles(
      context,
      `${context.serverDirectories.srcDirectory}/interceptors`,
      interceptorsStaticPath
    );

    const staticsFiles = await AuthCorePlugin.getStaticFiles(
      context,
      context.serverDirectories.authDirectory,
      staticPath
    );

    staticsInterceptorsFiles.forEach((file) => {
      staticsFiles.push(file);
    });

    // 1. create user info
    const userInfo = await createUserInfo(context);
    // 2. create token payload interface
    const tokenPayloadInterface = await createTokenPayloadInterface(context);
    // 3. create constants for tests
    const athConstants = await createAuthConstants(context);
    // 4. create token service
    const tokenService = await createTokenService(context);
    // 5. create token service test
    const tokenServiceTest = await createTokenServiceTests(context);
    // 6. create grants
    const grants = createGrantsModule(
      context.serverDirectories.srcDirectory,
      context.entities,
      context.roles
    );

    // 7. create create Default Guard
    const { resourceInfo, serverDirectories } = context;
    const authDir = `${serverDirectories.srcDirectory}/auth`;
    const authTestsDir = `${serverDirectories.srcDirectory}/tests/auth`;

    let defaultGuardFile: Module = {
      path: "",
      code: "",
    };
    if (resourceInfo) {
      defaultGuardFile = await createDefaultGuard(
        resourceInfo.settings.authProvider,
        authDir
      );
    }

    const results = grants
      ? [
          userInfo,
          tokenPayloadInterface,
          athConstants,
          tokenService,
          tokenServiceTest,
          ...staticsFiles,
          defaultGuardFile,
          grants,
        ]
      : [
          userInfo,
          tokenPayloadInterface,
          athConstants,
          tokenService,
          tokenServiceTest,
          ...staticsFiles,
          defaultGuardFile,
        ];
    return results;
  }

  async beforeCreateEntityModuleBase(
    context: DsgContext,
    eventParams: CreateEntityModuleBaseParams
  ) {
    const aclModuleId = builders.identifier("ACLModule");
    const authModuleId = builders.identifier("AuthModule");
    const forwardRefId = builders.identifier("forwardRef");
    const forwardRefArrowFunction = builders.arrowFunctionExpression(
      [],
      authModuleId
    );

    const forwardAuthId = builders.callExpression(forwardRefId, [
      forwardRefArrowFunction,
    ]);

    const aclModuleImport = importNames([aclModuleId], "../../auth/acl.module");
    const authModuleImport = importNames(
      [authModuleId],
      "../../auth/auth.module"
    );
    const forwardRefImport = importNames([forwardRefId], "@nestjs/common");

    const importArray = builders.arrayExpression([
      aclModuleId,
      authModuleId,
      forwardAuthId,
      ...eventParams.templateMapping["IMPORTS_ARRAY"].elements,
    ]);

    const exportArray = builders.arrayExpression([
      aclModuleId,
      authModuleId,
      ...eventParams.templateMapping["EXPORT_ARRAY"].elements,
    ]);

    eventParams.templateMapping["IMPORTS_ARRAY"] = importArray;
    eventParams.templateMapping["EXPORT_ARRAY"] = exportArray;

    addImports(
      eventParams.template,
      [aclModuleImport, authModuleImport, forwardRefImport].filter(
        (x) => x //remove nulls and undefined
      ) as namedTypes.ImportDeclaration[]
    );
    return eventParams;
  }

  private static async getStaticFiles(
    context: DsgContext,
    basePath: string,
    staticPath: string
  ) {
    const staticsFiles = await context.utils.importStaticModules(
      staticPath,
      basePath
    );

    return staticsFiles;
  }

  beforeCreateControllerBaseModule(
    context: DsgContext,
    eventParams: CreateEntityControllerBaseParams
  ) {
    const { templateMapping, entity, template, controllerBaseId } = eventParams;

    interpolate(template, templateMapping);

    const classDeclaration = getClassDeclarationById(
      template,
      controllerBaseId
    );

    const nestAccessControlImport = builders.importDeclaration(
      [
        builders.importNamespaceSpecifier(
          builders.identifier("nestAccessControl")
        ),
      ],
      builders.stringLiteral("nest-access-control")
    );

    const defaultAuthGuardId = builders.identifier("DefaultAuthGuard");

    const defaultAuthGuardImport = importNames(
      [defaultAuthGuardId],
      "../../auth/defaultAuth.guard"
    );

    const ignoreComment = builders.commentLine("// @ts-ignore", false);

    if (!defaultAuthGuardImport.comments) {
      defaultAuthGuardImport.comments = [];
    }

    defaultAuthGuardImport.comments.push(ignoreComment);

    addImports(
      eventParams.template,
      [nestAccessControlImport, defaultAuthGuardImport].filter(
        (x) => x //remove nulls and undefined
      ) as namedTypes.ImportDeclaration[]
    );

    // const guardDecorator = builders.decorator(
    //   builders.callExpression(
    //     builders.memberExpression(
    //       builders.identifier("common"),
    //       builders.identifier("UseGuards")
    //     ),
    //     [builders.identifier("DefaultAuthGuard")]
    //   )
    // );

    // const classDeclarationWithClassDecorator = addDecoratorsToClassDeclaration(
    //   classDeclaration,
    //   [guardDecorator]
    // );

    if (classDeclaration) {
      controllerMethodsIdsActionPairs(templateMapping, entity).forEach(
        ({ methodId, action, entity }) => {
          setAuthPermissions(classDeclaration, methodId, action, entity.name);
        }
      );
    }

    return eventParams;
  }

  beforeCreateEntityControllerToManyRelationMethods(
    context: DsgContext,
    eventParams: CreateEntityControllerToManyRelationMethodsParams
  ) {
    const relatedEntity = eventParams.field.properties?.relatedEntity;

    interpolate(eventParams.toManyFile, eventParams.toManyMapping);

    const toManyClassDeclaration = getClassDeclarationById(
      eventParams.toManyFile,
      TO_MANY_MIXIN_ID
    );

    controllerToManyMethodsIdsActionPairs(
      eventParams.toManyMapping,
      eventParams.entity,
      relatedEntity
    ).forEach(({ methodId, action, entity }) => {
      setAuthPermissions(toManyClassDeclaration, methodId, action, entity.name);
    });

    return eventParams;
  }

  beforeCreateEntityResolverToOneRelationMethods(
    context: DsgContext,
    eventParams: CreateEntityResolverToOneRelationMethodsParams
  ) {
    const relatedEntity = eventParams.field.properties?.relatedEntity;

    interpolate(eventParams.toOneFile, eventParams.toOneMapping);

    const classDeclaration = getClassDeclarationById(
      eventParams.toOneFile,
      TO_MANY_MIXIN_ID
    );

    setAuthPermissions(
      classDeclaration,
      eventParams.toOneMapping["FIND_ONE"] as namedTypes.Identifier,
      EnumEntityAction.View,
      relatedEntity.name
    );

    return eventParams;
  }

  beforeCreateEntityResolverToManyRelationMethods(
    context: DsgContext,
    eventParams: CreateEntityResolverToManyRelationMethodsParams
  ) {
    const relatedEntity = eventParams.field.properties?.relatedEntity;

    interpolate(eventParams.toManyFile, eventParams.toManyMapping);

    const toManyClassDeclaration = getClassDeclarationById(
      eventParams.toManyFile,
      TO_MANY_MIXIN_ID
    );

    setAuthPermissions(
      toManyClassDeclaration,
      eventParams.toManyMapping["FIND_MANY"] as namedTypes.Identifier,
      EnumEntityAction.Search,
      relatedEntity.name
    );

    return eventParams;
  }

  beforeCreateResolverBaseModule(
    context: DsgContext,
    eventParams: CreateEntityResolverBaseParams
  ) {
    const { templateMapping, entity, template, resolverBaseId } = eventParams;

    interpolate(template, templateMapping);

    const classDeclaration = getClassDeclarationById(template, resolverBaseId);

    const nestAccessControlImport = builders.importDeclaration(
      [
        builders.importNamespaceSpecifier(
          builders.identifier("nestAccessControl")
        ),
      ],
      builders.stringLiteral("nest-access-control")
    );

    const gqlACGuardImport = builders.importDeclaration(
      [builders.importNamespaceSpecifier(builders.identifier("gqlACGuard"))],
      builders.stringLiteral("../../auth/gqlAC.guard")
    );

    const gqlDefaultAuthGuardId = builders.identifier("GqlDefaultAuthGuard");
    const gqlDefaultAuthGuardImport = importNames(
      [gqlDefaultAuthGuardId],
      "../../auth/gqlDefaultAuth.guard"
    );

    const swaggerImport = builders.importDeclaration(
      [builders.importNamespaceSpecifier(builders.identifier("swagger"))],
      builders.stringLiteral("@nestjs/swagger")
    );

    const commonImport = builders.importDeclaration(
      [builders.importNamespaceSpecifier(builders.identifier("common"))],
      builders.stringLiteral("@nestjs/common")
    );

    gqlDefaultAuthGuardImport.specifiers;
    namedTypes.ImportNamespaceSpecifier;

    const ignoreComment = builders.commentLine("// @ts-ignore", false);

    if (!gqlACGuardImport.comments) {
      gqlACGuardImport.comments = [];
    }

    gqlACGuardImport.comments.push(ignoreComment);

    addImports(
      eventParams.template,
      [
        nestAccessControlImport,
        gqlACGuardImport,
        gqlDefaultAuthGuardImport,
        commonImport,
        swaggerImport,
      ].filter(
        (x) => x //remove nulls and undefined
      ) as namedTypes.ImportDeclaration[]
    );
    if (classDeclaration) {
      resolverMethodsIdsActionPairs(templateMapping, entity).forEach(
        ({ methodId, action, entity }) => {
          setAuthPermissions(classDeclaration, methodId, action, entity.name);
        }
      );
    }

    return eventParams;
  }

  beforeCreateEntityService(
    context: DsgContext,
    eventParams: CreateEntityServiceParams
  ) {
    const { template, serviceId, entityName, templateMapping } = eventParams;
    const modulePath = `${context.serverDirectories.srcDirectory}/${entityName}/${entityName}.service.ts`;
    const passwordFields = AuthCorePlugin.getPasswordFields(
      context,
      eventParams.entityName
    );
    if (!passwordFields?.length) return eventParams;

    // templateMapping["CREATE_ARGS_MAPPING"] =
    //   AuthCorePlugin.createMutationDataMapping(
    //     passwordFields.map((field) => {
    //       const fieldId = builders.identifier(field.name);
    //       return builders.objectProperty(
    //         fieldId,
    //         awaitExpression`await ${HASH_MEMBER_EXPRESSION}(${ARGS_ID}.${DATA_ID}.${fieldId})`
    //       );
    //     })
    //   );

    // templateMapping["UPDATE_ARGS_MAPPING"] =
    //   AuthCorePlugin.createMutationDataMapping(
    //     passwordFields.map((field) => {
    //       const fieldId = builders.identifier(field.name);
    //       const valueMemberExpression = memberExpression`${ARGS_ID}.${DATA_ID}.${fieldId}`;
    //       return builders.objectProperty(
    //         fieldId,
    //         logicalExpression`${valueMemberExpression} && await ${TRANSFORM_STRING_FIELD_UPDATE_INPUT_ID}(
    //         ${ARGS_ID}.${DATA_ID}.${fieldId},
    //         (password) => ${HASH_MEMBER_EXPRESSION}(password)
    //       )`
    //       );
    //     })
    //   );

    interpolate(template, templateMapping);

    //if there are any password fields, add imports, injection, and pass service to super
    if (passwordFields.length) {
      const classDeclaration = getClassDeclarationById(template, serviceId);

      addInjectableDependency(
        classDeclaration,
        PASSWORD_SERVICE_MEMBER_ID.name,
        PASSWORD_SERVICE_ID,
        "protected"
      );

      addIdentifierToConstructorSuperCall(template, PASSWORD_SERVICE_MEMBER_ID);

      for (const member of classDeclaration.body.body) {
        if (
          namedTypes.ClassMethod.check(member) &&
          namedTypes.Identifier.check(member.key) &&
          PASSWORD_FIELD_ASYNC_METHODS.has(member.key.name)
        ) {
          member.async = true;
        }
      }
      //add the password service
      addImports(template, [
        importNames(
          [PASSWORD_SERVICE_ID],
          relativeImportPath(
            modulePath,
            `${context.serverDirectories.srcDirectory}/auth/password.service.ts`
          )
        ),
      ]);
    }
    return eventParams;
  }

  static createMutationDataMapping(
    mappings: namedTypes.ObjectProperty[]
  ): namedTypes.Identifier | namedTypes.ObjectExpression {
    if (!mappings.length) {
      return ARGS_ID;
    }
    return builders.objectExpression([
      builders.spreadProperty(ARGS_ID),
      builders.objectProperty(
        DATA_ID,
        builders.objectExpression([
          builders.spreadProperty(memberExpression`${ARGS_ID}.${DATA_ID}`),
          ...mappings,
        ])
      ),
    ]);
  }
  beforeCreateEntityServiceBase(
    context: DsgContext,
    eventParams: CreateEntityServiceBaseParams
  ) {
    const { template, templateMapping, serviceBaseId, entityName, entity } =
      eventParams;
    const { serverDirectories } = context;
    const passwordFields = entity.fields.filter(isPasswordField);

    if (!passwordFields?.length) return eventParams;

    interpolate(template, templateMapping);

    const classDeclaration = getClassDeclarationById(template, serviceBaseId);
    const moduleBasePath = `${serverDirectories.srcDirectory}/${entityName}/base/${entityName}.service.base.ts`;

    addInjectableDependency(
      classDeclaration,
      PASSWORD_SERVICE_MEMBER_ID.name,
      PASSWORD_SERVICE_ID,
      "protected"
    );

    for (const member of classDeclaration.body.body) {
      if (
        namedTypes.ClassMethod.check(member) &&
        namedTypes.Identifier.check(member.key) &&
        PASSWORD_FIELD_ASYNC_METHODS.has(member.key.name)
      ) {
        member.async = true;
      }
    }
    //add the password service
    addImports(template, [
      importNames(
        [PASSWORD_SERVICE_ID],
        relativeImportPath(
          moduleBasePath,
          `${context.serverDirectories.srcDirectory}/auth/password.service.ts`
        )
      ),
    ]);

    addImports(template, [
      importNames(
        [TRANSFORM_STRING_FIELD_UPDATE_INPUT_ID],
        relativeImportPath(
          moduleBasePath,
          `${serverDirectories.srcDirectory}/prisma.util.ts`
        )
      ),
    ]);

    return eventParams;
  }

  private static getPasswordFields(
    context: DsgContext,
    entityName: string
  ): EntityField[] | undefined {
    const entity = context.entities?.find(
      (entity) =>
        entity.name.toLocaleLowerCase() === entityName.toLocaleLowerCase()
    );

    return entity?.fields.filter(isPasswordField);
  }
}

export default AuthCorePlugin;
