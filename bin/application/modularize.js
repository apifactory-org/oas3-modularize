/**
 * =============================================================================
 * MODULARIZE.JS — Modularizador de Especificaciones OpenAPI
 * =============================================================================
 *
 * PROPÓSITO:
 * ----------
 * Transforma un archivo OpenAPI monolítico en una estructura modular de
 * archivos separados, facilitando el mantenimiento y la colaboración.
 *
 * ENTRADA:
 *   Un archivo OpenAPI 3.x monolítico (todo en un solo archivo)
 *
 * SALIDA:
 *   Estructura de carpetas con archivos separados:
 *   
 *   src/
 *   ├── main.yaml                    # Entrypoint con $refs
 *   ├── paths/
 *   │   ├── users.yaml
 *   │   ├── users-id.yaml
 *   │   └── orders.yaml
 *   └── components/
 *       ├── schemas/
 *       │   ├── UserSchema.yaml
 *       │   └── OrderSchema.yaml
 *       ├── responses/
 *       │   ├── NotFoundResponse.yaml
 *       │   └── BadRequestResponse.yaml
 *       └── parameters/
 *           └── PageSizeParam.yaml
 *
 * FLUJO DE EJECUCIÓN:
 * -------------------
 *
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 1: PREPARACIÓN                                                │
 *   │ ────────────────────                                               │
 *   │ • Leer archivo de entrada                                          │
 *   │ • Validar versión OpenAPI (3.x)                                    │
 *   │ • Crear estructura de carpetas                                     │
 *   └─────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 2: NORMALIZACIÓN DE RESPONSES                                 │
 *   │ ──────────────────────────────────                                 │
 *   │ • Renombrar responses con convención consistente                   │
 *   │ • Extraer responses inline de paths a components                   │
 *   │ • Deduplicar responses idénticas                                   │
 *   └─────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 3: MODULARIZACIÓN DE COMPONENTS                               │
 *   │ ────────────────────────────────────                               │
 *   │ • Separar schemas en archivos individuales                         │
 *   │ • Separar responses, parameters, requestBodies, etc.               │
 *   │ • Aplicar convención de nombres y afijos                           │
 *   │ • Opcionalmente filtrar componentes no usados                      │
 *   └─────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 4: MODULARIZACIÓN DE PATHS                                    │
 *   │ ──────────────────────────────────                                 │
 *   │ • Separar cada endpoint en archivo propio                          │
 *   │ • Slugificar rutas para nombres de archivo válidos                 │
 *   │ • Corregir referencias $ref a rutas relativas                      │
 *   └─────────────────────────────────────────────────────────────────────┘
 *                                     │
 *                                     ▼
 *   ┌─────────────────────────────────────────────────────────────────────┐
 *   │ PASO 5: FINALIZACIÓN                                               │
 *   │ ───────────────────                                                │
 *   │ • Generar entrypoint con referencias a módulos                     │
 *   │ • Eliminar carpetas vacías (opcional)                              │
 *   │ • Validar resultado con Redocly (opcional)                         │
 *   └─────────────────────────────────────────────────────────────────────┘
 *
 * CONFIGURACIÓN:
 * --------------
 * Todos los parámetros se leen desde config/modularize.yaml
 * Ver archivo de configuración para documentación detallada.
 *
 * USO PROGRAMÁTICO:
 * -----------------
 *
 *   const { createModularizer } = require('./modularize');
 *
 *   const modularizer = createModularizer();
 *   const result = await modularizer.run('./api/openapi.yaml');
 *
 *   console.log(result.stats);
 *   // { components: 15, paths: 8, responses: 12 }
 *
 * =============================================================================
 */

const path = require('path');
const crypto = require('crypto');
const chalk = require('chalk');
const prompts = require('prompts');

const { readYamlFile, writeYamlFile } = require('../infrastructure/yamlUtils');
const { removeDirIfExists, ensureDir, fileExists } = require('../infrastructure/fileSystem');
const { slugifyPath } = require('../core/slugifyPath');
const { fixRefs } = require('../core/fixRefs');
const { applyNamingConvention, generateComponentFilename, sanitizeComponentName } = require('../core/namingConventions');
const { validateWithRedocly } = require('./validate');
const { loadAllConfigs } = require('../infrastructure/configLoader');

// =============================================================================
// CONSTANTES
// =============================================================================

const CONFIG_MODULE_NAME = 'modularize';

const REQUIRED_CONFIG_FIELDS = [
  'paths.input',
  'paths.output',
  'behavior.cleanOutputDir',
  'behavior.fixRefs',
  'naming.components',
  'naming.paths',
  'advanced.fileExtension',
];

const COMPONENT_TYPES = [
  'schemas',
  'responses',
  'requestBodies',
  'parameters',
  'headers',
  'securitySchemes',
  'examples',
];

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'];

// =============================================================================
// ESTILOS DE CONSOLA
// =============================================================================

const styles = {
  divider: () => chalk.dim('─'.repeat(70)),
  section: (t) => chalk.bold.cyan(t),
  step: (t) => chalk.cyan('  → ' + t),
  success: (t) => chalk.green('  ✓ ' + t),
  warning: (t) => chalk.yellow('  ⚠ ' + t),
  error: (t) => chalk.red('  ✖ ' + t),
  info: (t) => chalk.blue('  ℹ ' + t),
};

// =============================================================================
// VALIDADORES
// =============================================================================

function assertBooleanField(obj, field, ctx) {
  if (obj[field] !== undefined && typeof obj[field] !== 'boolean') {
    throw new TypeError(`"${ctx}.${field}" debe ser booleano. Recibido: ${typeof obj[field]}`);
  }
}

function assertStringField(obj, field, ctx) {
  if (obj[field] !== undefined && typeof obj[field] !== 'string') {
    throw new TypeError(`"${ctx}.${field}" debe ser string. Recibido: ${typeof obj[field]}`);
  }
}

function assertRequiredField(val, fieldPath) {
  if (val === undefined) {
    throw new Error(`Falta campo requerido "${fieldPath}" en config/${CONFIG_MODULE_NAME}.yaml`);
  }
}

function getNestedValue(obj, p) {
  return p.split('.').reduce((c, k) => c?.[k], obj);
}

function assertValidOpenApiVersion(ver) {
  if (typeof ver !== 'string' || !/^3\.\d+(\.\d+)?$/.test(ver.trim())) {
    throw new Error(`Versión OpenAPI inválida: "${ver}". Se requiere 3.x`);
  }
}

// =============================================================================
// CARGADOR DE CONFIGURACIÓN
// =============================================================================

/**
 * @typedef {Object} ModularizeConfig
 * @property {string} inputPath
 * @property {string} outputDir
 * @property {string} mainFileName
 * @property {string} fileExtension
 * @property {string} filenamePrefix
 * @property {number} indent
 * @property {boolean} cleanOutputDir
 * @property {boolean} fixRefs
 * @property {boolean} validateAfterModularize
 * @property {boolean} removeEmptyFolders
 * @property {boolean} includeUnusedComponents
 * @property {Object} modularization
 * @property {Object} naming
 * @property {Object} affixes
 * @property {Object} responseNaming
 */

/**
 * Carga y valida la configuración desde config/modularize.yaml
 * @returns {ModularizeConfig}
 */
function loadModularizeConfig() {
  const all = loadAllConfigs();
  const root = all[CONFIG_MODULE_NAME];

  if (!root) {
    throw new Error(`No se encontró config/${CONFIG_MODULE_NAME}.yaml`);
  }

  // Validar campos requeridos
  for (const fp of REQUIRED_CONFIG_FIELDS) {
    assertRequiredField(getNestedValue(root, fp), fp);
  }

  const pathsCfg = root.paths || {};
  const behaviorCfg = root.behavior || {};
  const modCfg = root.modularization || {};
  const namingCfg = root.naming || {};
  const affixesCfg = root.affixes || { enabled: false, prefixes: {}, suffixes: {} };
  const respNamingCfg = root.responseNaming || { enabled: false };
  const advancedCfg = root.advanced || {};

  return {
    // Paths
    inputPath: pathsCfg.input,
    outputDir: pathsCfg.output,
    mainFileName: pathsCfg.mainFileName || 'openapi',
    
    // Advanced
    fileExtension: advancedCfg.fileExtension || '.yaml',
    filenamePrefix: advancedCfg.filenamePrefix || '',
    indent: advancedCfg.indent || 2,
    removeEmptyFolders: advancedCfg.removeEmptyFolders !== false,

    // Behavior
    cleanOutputDir: behaviorCfg.cleanOutputDir !== false,
    fixRefs: behaviorCfg.fixRefs !== false,
    validateAfterModularize: behaviorCfg.validateAfterModularize !== false,

    // Modularization flags
    modularization: {
      paths: modCfg.paths !== false,
      schemas: modCfg.schemas !== false,
      responses: modCfg.responses !== false,
      requestBodies: modCfg.requestBodies !== false,
      parameters: modCfg.parameters !== false,
      headers: modCfg.headers !== false,
      securitySchemes: modCfg.securitySchemes !== false,
      examples: modCfg.examples !== false,
    },
    includeUnusedComponents: modCfg.includeUnusedComponents !== false,

    // Naming
    naming: namingCfg,
    affixes: affixesCfg,
    responseNaming: respNamingCfg,
  };
}

// =============================================================================
// UTILIDADES PARA RESPONSES
// =============================================================================

function hashContent(content) {
  const normalized = JSON.stringify(content, Object.keys(content).sort());
  return crypto.createHash('md5').update(normalized).digest('hex').substring(0, 8);
}

function isSimpleResponse(resp) {
  const keys = Object.keys(resp || {});
  return keys.length === 0 || (keys.length === 1 && keys[0] === 'description');
}

function getContentSignature(resp) {
  if (!resp?.content) return null;
  const sig = {};
  for (const [mt, mc] of Object.entries(resp.content)) {
    sig[mt] = { schema: mc.schema || null };
  }
  return JSON.stringify(sig, Object.keys(sig).sort());
}

function shouldPreserveCustomName(statusCode, preserveList) {
  const code = parseInt(statusCode, 10);
  for (const pattern of preserveList || []) {
    if (pattern === String(statusCode)) return true;
    if (pattern === '2xx' && code >= 200 && code < 300) return true;
    if (pattern === '4xx' && code >= 400 && code < 500) return true;
    if (pattern === '5xx' && code >= 500 && code < 600) return true;
  }
  return false;
}

function normalizeResponseName(originalName, statusCode, description, respNamingCfg) {
  if (!respNamingCfg.enabled) return originalName;

  const statusNames = respNamingCfg.statusNames || {};
  const preserve = respNamingCfg.preserveCustomNames || [];
  const numCode = parseInt(statusCode, 10);

  let baseName = '';

  // Si está en la lista de preservar, mantener nombre original (con ajustes)
  if (!isNaN(numCode) && shouldPreserveCustomName(numCode, preserve)) {
    baseName = originalName;
    if (respNamingCfg.removeStatusCode) {
      baseName = baseName.replace(/\d{3}$/, '').replace(/\d{3}/, '');
    }
  } else if (respNamingCfg.useSemanticNames) {
    // Usar nombre semántico del mapeo
    if (statusCode === 'default') {
      baseName = statusNames.default || 'Default';
    } else {
      baseName = statusNames[statusCode] || statusNames[numCode] || 
                 sanitizeComponentName(description) || originalName;
    }
  } else {
    baseName = originalName;
    if (respNamingCfg.removeStatusCode) {
      baseName = baseName.replace(/\d{3}$/, '').replace(/\d{3}/, '');
    }
  }

  // Quitar "Response" existente para evitar duplicación
  baseName = baseName.replace(/Response$/i, '');

  // Agregar sufijo "Response" si está configurado
  if (respNamingCfg.ensureResponseSuffix) {
    baseName = baseName + 'Response';
  }

  // Agregar código al final si está configurado
  if (respNamingCfg.appendStatusCode && statusCode !== 'default') {
    baseName = baseName + statusCode;
  }

  return baseName;
}

function generateResponseNameForInline(statusCode, description, usedNames, respNamingCfg, namingCfg) {
  const statusNames = respNamingCfg.statusNames || {};
  let baseName = statusCode === 'default' 
    ? (statusNames.default || 'Default')
    : (statusNames[statusCode] || 'Status' + statusCode);

  let finalName = normalizeResponseName(baseName, statusCode, description || '', respNamingCfg);
  const convention = namingCfg.components || 'PascalCase';
  finalName = applyNamingConvention(finalName, convention);

  // Asegurar unicidad
  let uniqueName = finalName;
  let counter = 1;
  while (usedNames.has(uniqueName)) {
    uniqueName = finalName + counter++;
  }
  usedNames.add(uniqueName);
  return uniqueName;
}

// =============================================================================
// ANÁLISIS DE REFERENCIAS (para filtrar componentes no usados)
// =============================================================================

function collectUsedRefs(obj, refs = new Set()) {
  if (!obj || typeof obj !== 'object') return refs;
  
  if (obj.$ref && typeof obj.$ref === 'string') {
    refs.add(obj.$ref);
  }
  
  for (const val of Object.values(obj)) {
    if (Array.isArray(val)) {
      val.forEach(item => collectUsedRefs(item, refs));
    } else if (typeof val === 'object' && val !== null) {
      collectUsedRefs(val, refs);
    }
  }
  return refs;
}

function isComponentUsed(componentType, componentName, usedRefs) {
  const refPattern = `#/components/${componentType}/${componentName}`;
  for (const ref of usedRefs) {
    if (ref.includes(refPattern)) return true;
  }
  return false;
}

// =============================================================================
// PROCESADORES DE MODULARIZACIÓN
// =============================================================================

/**
 * Normaliza responses existentes en components/responses
 */
function normalizeExistingResponses(components, config, logger) {
  const respNaming = config.responseNaming;
  if (!respNaming.enabled || !components?.responses) {
    return { normalized: {}, refMapping: {} };
  }

  logger.log(styles.section('\n  NORMALIZANDO NOMBRES DE RESPONSES'));

  const normalized = {};
  const refMapping = {};
  const signatureToName = {};
  const genericDescs = respNaming.genericDescriptions || {};
  let changesCount = 0;

  for (const [originalName, content] of Object.entries(components.responses)) {
    const codeMatch = originalName.match(/(\d{3})/);
    const statusCode = codeMatch ? codeMatch[1] : 'default';
    const contentSig = getContentSignature(content);
    const simple = isSimpleResponse(content);

    // Clave de deduplicación
    let dedupeKey = simple 
      ? 'simple:' + statusCode
      : contentSig 
        ? statusCode + ':' + contentSig
        : 'unique:' + originalName;

    // Si ya existe uno igual, mapear al existente
    if (signatureToName[dedupeKey]) {
      const existingName = signatureToName[dedupeKey];
      refMapping['#/components/responses/' + originalName] = '#/components/responses/' + existingName;
      logger.log(styles.step(`${originalName} → ${existingName} (deduplicado)`));
      changesCount++;
      continue;
    }

    // Normalizar nombre
    const newName = normalizeResponseName(originalName, statusCode, content.description || '', respNaming);
    const convention = config.naming.components || 'PascalCase';
    const finalName = applyNamingConvention(newName, convention);

    // Normalizar contenido
    const normalizedContent = { ...content };
    if (genericDescs[statusCode] && !content.description) {
      normalizedContent.description = genericDescs[statusCode];
    }

    signatureToName[dedupeKey] = finalName;
    normalized[finalName] = normalizedContent;

    if (finalName !== originalName) {
      refMapping['#/components/responses/' + originalName] = '#/components/responses/' + finalName;
      logger.log(styles.step(`${originalName} → ${finalName}`));
      changesCount++;
    }
  }

  if (changesCount > 0) {
    logger.log(styles.success(`${changesCount} nombre(s) procesado(s)`));
  } else {
    logger.log(styles.info('Los nombres ya están normalizados'));
  }

  return { normalized, refMapping };
}

/**
 * Extrae responses inline de paths y los mueve a components
 */
function extractInlineResponses(paths, config, logger) {
  logger.log(styles.section('\n  EXTRAYENDO RESPONSES INLINE'));

  const respNaming = config.responseNaming;
  const genericDescs = respNaming.genericDescriptions || {};
  const extracted = {};
  const references = {};
  const simpleByCode = {};
  const sigMap = {};
  const usedNames = new Set();

  for (const [route, pathObj] of Object.entries(paths || {})) {
    if (!pathObj) continue;

    for (const [method, operation] of Object.entries(pathObj)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      if (!operation?.responses) continue;

      references[route] = references[route] || {};
      references[route][method] = {};

      for (const [statusCode, response] of Object.entries(operation.responses)) {
        if (response.$ref) continue;

        // Response simple (solo description o vacío)
        if (isSimpleResponse(response)) {
          if (simpleByCode[statusCode]) {
            references[route][method][statusCode] = simpleByCode[statusCode];
            continue;
          }
          const name = generateResponseNameForInline(statusCode, '', usedNames, respNaming, config.naming);
          extracted[name] = {
            description: genericDescs[statusCode] || `Response for status ${statusCode}`,
          };
          simpleByCode[statusCode] = name;
          references[route][method][statusCode] = name;
          continue;
        }

        // Response con content
        const sig = getContentSignature(response);
        if (sig) {
          const sigKey = statusCode + ':' + sig;
          if (sigMap[sigKey]) {
            references[route][method][statusCode] = sigMap[sigKey];
            continue;
          }
          const name = generateResponseNameForInline(statusCode, '', usedNames, respNaming, config.naming);
          extracted[name] = {
            description: genericDescs[statusCode] || response.description || `Response for status ${statusCode}`,
            content: response.content,
            ...(response.headers && { headers: response.headers }),
          };
          sigMap[sigKey] = name;
          references[route][method][statusCode] = name;
          continue;
        }

        // Response complejo único
        const hash = 'hash:' + hashContent(response);
        if (sigMap[hash]) {
          references[route][method][statusCode] = sigMap[hash];
          continue;
        }
        const name = generateResponseNameForInline(statusCode, response.description, usedNames, respNaming, config.naming);
        sigMap[hash] = name;
        extracted[name] = response;
        references[route][method][statusCode] = name;
      }
    }
  }

  const count = Object.keys(extracted).length;
  if (count > 0) {
    logger.log(styles.success(`${count} response(s) extraída(s)`));
  } else {
    logger.log(styles.info('No hay responses inline para extraer'));
  }

  return { extracted, references };
}

/**
 * Reemplaza responses inline con $refs
 */
function replaceInlineWithRefs(paths, references, config) {
  const ext = config.fileExtension;
  for (const [route, methods] of Object.entries(references)) {
    if (!paths[route]) continue;
    for (const [method, statuses] of Object.entries(methods)) {
      if (!paths[route][method]?.responses) continue;
      for (const [status, name] of Object.entries(statuses)) {
        paths[route][method].responses[status] = {
          $ref: `../components/responses/${name}${ext}`,
        };
      }
    }
  }
}

/**
 * Aplica mapeo de referencias a paths
 */
function applyRefMapping(paths, refMapping) {
  if (Object.keys(refMapping).length === 0) return;
  let str = JSON.stringify(paths);
  for (const [oldRef, newRef] of Object.entries(refMapping)) {
    const escaped = oldRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    str = str.replace(new RegExp(escaped, 'g'), newRef);
  }
  return JSON.parse(str);
}

/**
 * Modulariza los components según configuración
 */
function modularizeComponents(components, config, usedRefs, logger) {
  logger.log(styles.section('\n  MODULARIZANDO COMPONENTS'));

  const outputDir = path.normalize(config.outputDir);
  const componentsDir = path.join(outputDir, 'components');
  const stats = {};
  const entrypointRefs = {};

  for (const type of COMPONENT_TYPES) {
    // Verificar si este tipo debe modularizarse
    if (!config.modularization[type]) {
      logger.log(styles.info(`${type}: omitido por configuración`));
      continue;
    }

    const items = components?.[type];
    if (!items || Object.keys(items).length === 0) continue;

    const typeDir = path.join(componentsDir, type);
    ensureDir(typeDir);
    entrypointRefs[type] = {};
    stats[type] = 0;

    logger.log(styles.step(`Procesando ${type}:`));

    for (const [itemName, itemContent] of Object.entries(items)) {
      // Filtrar componentes no usados si está configurado
      if (!config.includeUnusedComponents && !isComponentUsed(type, itemName, usedRefs)) {
        logger.log(styles.warning(`  ${itemName} (no usado, omitido)`));
        continue;
      }

      // Generar nombre de archivo
      const fileName = config.filenamePrefix + generateComponentFilename(
        itemName, type, config.naming, config.affixes
      );
      const fileNameWithExt = fileName + config.fileExtension;
      const filePath = path.join(typeDir, fileNameWithExt);

      // Corregir refs si está habilitado
      let finalContent = itemContent;
      if (config.fixRefs) {
        finalContent = fixRefs(itemContent, type, config.mainFileName, config.naming, config.affixes);
      }

      writeYamlFile(filePath, finalContent, { indent: config.indent });
      entrypointRefs[type][itemName] = { $ref: `./components/${type}/${fileNameWithExt}` };
      stats[type]++;
      logger.log(styles.step(`  ${itemName} → ${fileNameWithExt}`));
    }
  }

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  if (total === 0) {
    logger.log(styles.warning('No se encontraron components para modularizar'));
  } else {
    logger.log(styles.success(`${total} component(s) modularizado(s)`));
  }

  return { entrypointRefs, stats };
}

/**
 * Modulariza los paths
 */
function modularizePaths(paths, config, logger) {
  logger.log(styles.section('\n  MODULARIZANDO PATHS'));

  if (!config.modularization.paths) {
    logger.log(styles.info('Modularización de paths omitida por configuración'));
    return { entrypointRefs: {}, stats: { paths: 0 } };
  }

  const outputDir = path.normalize(config.outputDir);
  const pathsDir = path.join(outputDir, 'paths');
  ensureDir(pathsDir);

  const entrypointRefs = {};
  let count = 0;
  let ignored = 0;

  for (const [route, pathObj] of Object.entries(paths || {})) {
    if (!pathObj || Object.keys(pathObj).length === 0) {
      logger.log(styles.warning(`Ruta vacía ignorada: ${route}`));
      ignored++;
      continue;
    }

    // Generar nombre de archivo
    const slugified = slugifyPath(route).replace(/\.yaml$/, '');
    const convention = config.naming.paths || 'kebab-case';
    const fileName = config.filenamePrefix + applyNamingConvention(slugified, convention);
    const fileNameWithExt = fileName + config.fileExtension;
    const filePath = path.join(pathsDir, fileNameWithExt);

    // Corregir refs si está habilitado
    let finalContent = pathObj;
    if (config.fixRefs) {
      finalContent = fixRefs(pathObj, 'paths', config.mainFileName, config.naming, config.affixes, true);
    }

    writeYamlFile(filePath, finalContent, { indent: config.indent });
    entrypointRefs[route] = { $ref: `./paths/${fileNameWithExt}` };
    count++;
    logger.log(styles.step(`${route} → ${fileNameWithExt}`));
  }

  if (count === 0) {
    throw new Error('No se encontraron paths válidos para modularizar');
  }

  logger.log(styles.success(`${count} path(s) modularizado(s), ${ignored} ignorado(s)`));

  return { entrypointRefs, stats: { paths: count } };
}

/**
 * Elimina carpetas vacías
 */
function cleanEmptyFolders(config, logger) {
  if (!config.removeEmptyFolders) return;

  const fs = require('fs');
  const componentsDir = path.join(path.normalize(config.outputDir), 'components');

  for (const type of COMPONENT_TYPES) {
    const typeDir = path.join(componentsDir, type);
    if (fs.existsSync(typeDir)) {
      const files = fs.readdirSync(typeDir);
      if (files.length === 0) {
        fs.rmdirSync(typeDir);
        logger.log(styles.info(`Carpeta vacía eliminada: components/${type}/`));
      }
    }
  }
}

// =============================================================================
// API PÚBLICA
// =============================================================================

/**
 * Crea una instancia del modularizador
 * @param {Object} options
 * @param {Object} options.logger - Logger personalizado
 * @returns {Object} Instancia del modularizador
 */
function createModularizer({ logger = console } = {}) {
  /**
   * Ejecuta el proceso de modularización
   * @param {string} [inputPathOverride] - Ruta de entrada (override de config)
   * @returns {Promise<Object>} Resultado con estadísticas
   */
  async function run(inputPathOverride) {
    const config = loadModularizeConfig();
    const inputPath = inputPathOverride || config.inputPath;
    const outputDir = path.normalize(config.outputDir);
    const mainFile = path.join(outputDir, config.mainFileName + config.fileExtension);

    logger.log('\n' + styles.divider());
    logger.log(styles.section('  PROCESO DE MODULARIZACIÓN'));
    logger.log(styles.divider());

    try {
      // ─────────────────────────────────────────────────────────────────
      // PASO 1: PREPARACIÓN
      // ─────────────────────────────────────────────────────────────────
      logger.log(styles.step(`Leyendo archivo: ${inputPath}`));

      if (!fileExists(inputPath)) {
        throw new Error(`El archivo de entrada no existe: ${inputPath}`);
      }

      const oasData = readYamlFile(inputPath);
      assertValidOpenApiVersion(oasData.openapi);
      logger.log(styles.success(`Versión OpenAPI válida: ${oasData.openapi}`));

      // Confirmar limpieza de carpeta
      if (fileExists(outputDir) && config.cleanOutputDir) {
        const response = await prompts({
          type: 'confirm',
          name: 'replace',
          message: `La carpeta ${outputDir} ya existe. ¿Deseas reemplazarla?`,
          initial: false,
        });
        if (!response.replace) {
          logger.log(styles.warning('Operación cancelada por el usuario'));
          return { success: false, cancelled: true };
        }
        removeDirIfExists(outputDir);
      }

      // Crear estructura
      logger.log(styles.step('Creando estructura de directorios...'));
      ensureDir(path.join(outputDir, 'components'));
      ensureDir(path.join(outputDir, 'paths'));
      logger.log(styles.success(`Directorios creados en: ${outputDir}`));

      // ─────────────────────────────────────────────────────────────────
      // PASO 2: NORMALIZACIÓN DE RESPONSES
      // ─────────────────────────────────────────────────────────────────
      const { normalized, refMapping } = normalizeExistingResponses(
        oasData.components, config, logger
      );

      if (Object.keys(normalized).length > 0) {
        oasData.components.responses = normalized;
      }

      if (Object.keys(refMapping).length > 0) {
        oasData.paths = applyRefMapping(oasData.paths, refMapping);
      }

      // Extraer responses inline
      const { extracted, references } = extractInlineResponses(oasData.paths, config, logger);

      if (Object.keys(extracted).length > 0) {
        if (!oasData.components) oasData.components = {};
        if (!oasData.components.responses) oasData.components.responses = {};
        Object.assign(oasData.components.responses, extracted);
        replaceInlineWithRefs(oasData.paths, references, config);
      }

      // ─────────────────────────────────────────────────────────────────
      // PASO 3: MODULARIZACIÓN DE COMPONENTS
      // ─────────────────────────────────────────────────────────────────
      const usedRefs = collectUsedRefs(oasData.paths);
      const { entrypointRefs: compRefs, stats: compStats } = modularizeComponents(
        oasData.components, config, usedRefs, logger
      );

      // ─────────────────────────────────────────────────────────────────
      // PASO 4: MODULARIZACIÓN DE PATHS
      // ─────────────────────────────────────────────────────────────────
      const { entrypointRefs: pathRefs, stats: pathStats } = modularizePaths(
        oasData.paths, config, logger
      );

      // ─────────────────────────────────────────────────────────────────
      // PASO 5: FINALIZACIÓN
      // ─────────────────────────────────────────────────────────────────
      logger.log(styles.section('\n  GENERANDO ENTRYPOINT'));

      // Construir entrypoint
      const entrypoint = {
        openapi: oasData.openapi,
        info: oasData.info,
        servers: oasData.servers || [],
        tags: oasData.tags || [],
        security: oasData.security || [],
        ...(oasData.externalDocs && { externalDocs: oasData.externalDocs }),
        paths: pathRefs,
        components: compRefs,
      };

      // Copiar extensiones x-*
      for (const [key, val] of Object.entries(oasData)) {
        if (key.startsWith('x-')) entrypoint[key] = val;
      }

      writeYamlFile(mainFile, entrypoint, { indent: config.indent });
      logger.log(styles.step(`Archivo principal: ${path.basename(mainFile)}`));

      // Limpiar carpetas vacías
      cleanEmptyFolders(config, logger);

      // Validar con Redocly
      if (config.validateAfterModularize) {
        logger.log(styles.section('\n  VALIDANDO CON REDOCLY'));
        await validateWithRedocly(mainFile);
      }

      // ─────────────────────────────────────────────────────────────────
      // RESUMEN
      // ─────────────────────────────────────────────────────────────────
      const allStats = { ...compStats, ...pathStats };

      logger.log('\n' + styles.divider());
      logger.log(chalk.green.bold('  MODULARIZACIÓN COMPLETADA'));
      logger.log(styles.divider());
      logger.log(styles.success(`Carpeta generada: ${outputDir}`));
      logger.log(styles.info('Resumen:'));

      for (const [type, count] of Object.entries(allStats)) {
        if (count > 0) {
          logger.log(styles.info(`  - ${type}: ${count} archivo(s)`));
        }
      }

      logger.log('');

      return { success: true, stats: allStats, outputDir, mainFile };

    } catch (error) {
      logger.log('\n' + styles.divider());
      logger.log(chalk.red.bold('  ERROR EN MODULARIZACIÓN'));
      logger.log(styles.divider());
      logger.log(styles.error(error.message));
      logger.log('');
      throw error;
    }
  }

  function getConfig() {
    return loadModularizeConfig();
  }

  return { run, getConfig };
}

/**
 * Función de conveniencia para modularizar
 */
async function modularize(inputPath) {
  const modularizer = createModularizer();
  return modularizer.run(inputPath);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createModularizer,
  modularize,
  __internal: {
    loadModularizeConfig,
    normalizeResponseName,
    collectUsedRefs,
    isComponentUsed,
    COMPONENT_TYPES,
    HTTP_METHODS,
  },
};