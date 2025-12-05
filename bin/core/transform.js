/**
 * =============================================================================
 * TRANSFORM.JS — Transformador de Especificaciones OpenAPI
 * =============================================================================
 *
 * PROPÓSITO:
 * ----------
 * Analiza un archivo OpenAPI y genera mappings de transformación según el
 * estilo/scaffolding seleccionado. NO escribe archivos, solo produce:
 *   - OpenAPI transformado (en memoria)
 *   - schemaMapping (nombre → carpeta + fileName)
 *   - responseMapping (nombre → carpeta + fileName)
 *   - requestBodyMapping (nombre → carpeta + fileName)
 *
 * RESPONSABILIDADES:
 * ------------------
 *   ✓ Detectar estilo de API (REST, BIAN, RPC, Google, etc.)
 *   ✓ Clasificar schemas (object, enum, array, property, composite)
 *   ✓ Normalizar nombres de responses
 *   ✓ Extraer responses inline → components
 *   ✓ Generar nombres inteligentes según estilo
 *   ✓ Deduplicar responses por contenido
 *   ✓ Generar mappings para el scaffolding
 *
 *   ✗ NO crea carpetas
 *   ✗ NO escribe archivos
 *   ✗ NO ajusta $ref (eso lo hace modularize con los mappings)
 *
 * =============================================================================
 */

const crypto = require('crypto');
const { detectApiStyle } = require('./detectApiStyle');
const { applyNamingConvention, sanitizeComponentName } = require('./namingConventions');
const { loadAllConfigs } = require('../infrastructure/configLoader');

// =============================================================================
// CONSTANTES
// =============================================================================

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'];

const SCHEMA_TYPES = {
  OBJECT: 'objects',
  PROPERTY: 'properties',
  ENUM: 'enums',
  ARRAY: 'arrays',
  COMPOSITE: 'composites',
};

// =============================================================================
// CARGA DE CONFIGURACIÓN DE SCAFFOLDINGS
// =============================================================================

/**
 * Carga los scaffoldings disponibles desde config
 * @returns {Object} scaffoldings por nombre
 */
function loadScaffoldings() {
  const all = loadAllConfigs();
  return all.scaffoldings || {};
}

/**
 * Obtiene un scaffolding específico por nombre
 * @param {string} name - standard, restful, rpc, google, bian
 * @returns {Object} configuración del scaffolding
 */
function getScaffolding(name) {
  const scaffoldings = loadScaffoldings();
  const scaffolding = scaffoldings[name];
  
  if (!scaffolding) {
    throw new Error(`Scaffolding "${name}" no encontrado. Disponibles: ${Object.keys(scaffoldings).join(', ')}`);
  }
  
  return scaffolding;
}

// =============================================================================
// CLASIFICACIÓN DE SCHEMAS
// =============================================================================

/**
 * Clasifica un schema según su estructura.
 *
 * Orden de prioridad:
 *   1. enum      → Cualquier schema con campo "enum"
 *   2. array     → type: array
 *   3. composite → allOf, oneOf, anyOf
 *   4. object    → type: object CON properties (entidades)
 *   5. property  → tipos primitivos (string, number, integer, boolean)
 *   6. object    → type: object SIN properties (free-form)
 *
 * @param {Object} schema - Definición del schema
 * @returns {string} Tipo: 'objects' | 'properties' | 'enums' | 'arrays' | 'composites'
 */
function classifySchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return SCHEMA_TYPES.OBJECT;
  }

  if (schema.enum) return SCHEMA_TYPES.ENUM;
  if (schema.type === 'array') return SCHEMA_TYPES.ARRAY;
  if (schema.allOf || schema.oneOf || schema.anyOf) return SCHEMA_TYPES.COMPOSITE;
  if (schema.type === 'object' && schema.properties) return SCHEMA_TYPES.OBJECT;
  if (['string', 'number', 'integer', 'boolean'].includes(schema.type)) return SCHEMA_TYPES.PROPERTY;
  
  return SCHEMA_TYPES.OBJECT;
}

/**
 * Genera el mapping de schemas según el scaffolding
 * @param {Object} schemas - components.schemas del OpenAPI
 * @param {Object} scaffolding - configuración del scaffolding
 * @param {Object} namingConfig - configuración de naming
 * @returns {Object} schemaMapping
 */
function buildSchemaMapping(schemas, scaffolding, namingConfig) {
  if (!schemas) return {};

  const mapping = {};
  const useClassification = scaffolding.schemaClassification !== false;
  const folders = scaffolding.folders || {};
  const suffixes = scaffolding.suffixes || {};
  const convention = namingConfig?.components || 'PascalCase';

  for (const [name, schema] of Object.entries(schemas)) {
    const schemaType = classifySchema(schema);
    
    let folder;
    let suffix;

    if (useClassification && folders[schemaType]) {
      folder = folders[schemaType];
      suffix = suffixes[schemaType] || '';
    } else {
      folder = 'schemas';
      suffix = suffixes.schemas || '';
    }

    let fileName = applyNamingConvention(name, convention);
    if (suffix && !fileName.endsWith(suffix)) {
      fileName = fileName + suffix;
    }

    mapping[name] = {
      folder,
      fileName,
      type: schemaType,
      original: name,
    };
  }

  return mapping;
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

function is2xxStatus(statusCode) {
  const n = parseInt(statusCode, 10);
  return !isNaN(n) && n >= 200 && n < 300;
}

function naiveSingularize(name) {
  if (!name) return name;
  if (/ies$/i.test(name)) return name.replace(/ies$/i, 'y');
  if (/ses$/i.test(name)) return name.replace(/es$/i, '');
  if (/s$/i.test(name)) return name.replace(/s$/i, '');
  return name;
}

// =============================================================================
// INFERENCIA DE NOMBRES INTELIGENTES
// =============================================================================

/**
 * Infiere el nombre de la entidad desde el path
 * /users/{id} → User
 * /PartyReferenceDataDirectory/{crId}/Demographics → Demographics
 */
function inferEntityFromPath(route, operation) {
  if (operation?.operationId) {
    const opId = operation.operationId.trim();
    const words = opId.replace(/([a-z])([A-Z])/g, '$1 $2').split(/[\s_-]+/);
    const verbs = ['get', 'list', 'create', 'update', 'delete', 'retrieve', 'search', 
                   'register', 'exchange', 'execute', 'control', 'request', 'initiate',
                   'notify', 'approve', 'reject', 'activate', 'deactivate'];
    const candidate = words.find(w => !verbs.includes(w.toLowerCase()));
    if (candidate) {
      return applyNamingConvention(candidate, 'PascalCase');
    }
  }

  if (typeof route !== 'string') return 'Resource';

  const segments = route
    .split('/')
    .filter(s => s && !s.startsWith('{') && !/^v\d+$/i.test(s) && s !== 'api');

  if (segments.length === 0) return 'Resource';

  let last = segments[segments.length - 1];
  
  // Remover prefijo ":" de Google style
  if (last.startsWith(':')) {
    last = segments.length > 1 ? segments[segments.length - 2] : 'Resource';
  }

  last = last.replace(/[_-]+/g, ' ');
  last = applyNamingConvention(last, 'PascalCase');
  last = naiveSingularize(last);

  return last || 'Resource';
}

/**
 * Infiere la acción desde el path (para estilos RPC/BIAN)
 * /employees/{id}/notify → Notify
 * /PartyReferenceDataDirectory/Register → Register
 */
function inferActionFromPath(route, method) {
  if (typeof route !== 'string') return null;

  const segments = route
    .split('/')
    .filter(s => s && !s.startsWith('{') && !/^v\d+$/i.test(s) && s !== 'api');

  if (segments.length === 0) return null;

  const last = segments[segments.length - 1];
  
  // Google style :action
  if (last.startsWith(':')) {
    return applyNamingConvention(last.substring(1), 'PascalCase');
  }

  // BIAN/RPC - verbos conocidos al final
  const knownActions = [
    // BIAN
    'Register', 'Retrieve', 'Update', 'Execute', 'Exchange', 'Control', 
    'Request', 'Initiate', 'Create', 'Evaluate', 'Provide', 'Notify', 'Capture',
    // RPC
    'notify', 'approve', 'reject', 'activate', 'deactivate', 'transfer',
    'promote', 'calculate', 'search', 'generate', 'archive', 'delete'
  ];

  const lastPascal = applyNamingConvention(last, 'PascalCase');
  if (knownActions.some(a => a.toLowerCase() === last.toLowerCase())) {
    return lastPascal;
  }

  return null;
}

/**
 * Genera nombre inteligente para response según estilo
 */
function buildSmartResponseName(statusCode, route, method, operation, style, statusNames) {
  const entity = inferEntityFromPath(route, operation);
  const action = inferActionFromPath(route, method);
  const m = (method || '').toLowerCase();

  // Para errores, usar nombres semánticos estándar
  if (!is2xxStatus(statusCode)) {
    const baseName = statusNames?.[statusCode] || `Status${statusCode}`;
    return baseName + 'Response';
  }

  // Para 2xx, generar nombre según estilo
  switch (style) {
    case 'bian':
      if (action) return `${action}${entity}Response`;
      return `${getVerbForMethod(m)}${entity}Response`;

    case 'rpc':
      if (action) return `${action}${entity}Response`;
      return `${getVerbForMethod(m)}${entity}Response`;

    case 'google':
      if (action) return `${action}${entity}Response`;
      return `${getVerbForMethod(m)}${entity}Response`;

    case 'restful':
    default:
      return `${getVerbForMethod(m)}${entity}Response`;
  }
}

function getVerbForMethod(method) {
  const verbs = {
    get: 'Retrieve',
    post: 'Create',
    put: 'Update',
    patch: 'Patch',
    delete: 'Delete',
  };
  return verbs[method] || 'Operation';
}

// =============================================================================
// EXTRACCIÓN DE RESPONSES INLINE
// =============================================================================

/**
 * Extrae responses inline de paths y genera mapping
 */
function extractInlineResponses(paths, scaffolding, style, namingConfig) {
  const responseNaming = scaffolding.responseNaming || {};
  const statusNames = responseNaming.statusNames || {};
  const dedupeErrors = responseNaming.dedupeErrors !== false;
  
  const extractedResponses = {};
  const responseMapping = {};
  const transformedPaths = JSON.parse(JSON.stringify(paths));
  
  const usedNames = new Set();
  const errorSignatures = {};

  for (const [route, pathObj] of Object.entries(paths || {})) {
    if (!pathObj) continue;

    for (const [method, operation] of Object.entries(pathObj)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      if (!operation?.responses) continue;

      for (const [statusCode, response] of Object.entries(operation.responses)) {
        if (response.$ref) continue;

        const is2xx = is2xxStatus(statusCode);

        // Deduplicación de errores
        if (!is2xx && dedupeErrors) {
          const sig = getContentSignature(response) || 'simple:' + statusCode;
          if (errorSignatures[sig]) {
            transformedPaths[route][method].responses[statusCode] = {
              $ref: `#/components/responses/${errorSignatures[sig]}`
            };
            continue;
          }
        }

        // Generar nombre
        let responseName;
        if (responseNaming.enabled) {
          responseName = buildSmartResponseName(
            statusCode, route, method, operation, style, statusNames
          );
        } else {
          responseName = `Response${statusCode}`;
        }

        // Asegurar unicidad
        let uniqueName = responseName;
        let counter = 1;
        while (usedNames.has(uniqueName)) {
          uniqueName = responseName.replace(/Response$/, '') + counter + 'Response';
          counter++;
        }
        usedNames.add(uniqueName);

        if (!is2xx && dedupeErrors) {
          const sig = getContentSignature(response) || 'simple:' + statusCode;
          errorSignatures[sig] = uniqueName;
        }

        extractedResponses[uniqueName] = response;

        responseMapping[uniqueName] = {
          folder: 'responses',
          fileName: uniqueName,
          statusCode,
          route,
          method,
          original: null,
        };

        transformedPaths[route][method].responses[statusCode] = {
          $ref: `#/components/responses/${uniqueName}`
        };
      }
    }
  }

  return { transformedPaths, extractedResponses, responseMapping };
}

// =============================================================================
// NORMALIZACIÓN DE RESPONSES EXISTENTES
// =============================================================================

function normalizeExistingResponses(responses, scaffolding, namingConfig) {
  if (!responses) return { normalizedResponses: {}, responseMapping: {}, refMapping: {} };

  const responseNaming = scaffolding.responseNaming || {};
  const statusNames = responseNaming.statusNames || {};
  const convention = namingConfig?.components || 'PascalCase';
  
  const normalizedResponses = {};
  const responseMapping = {};
  const refMapping = {};
  const usedNames = new Set();

  for (const [originalName, content] of Object.entries(responses)) {
    const codeMatch = originalName.match(/(\d{3})/);
    const statusCode = codeMatch ? codeMatch[1] : 'default';

    let newName;
    if (responseNaming.enabled) {
      let baseName = statusNames[statusCode] || originalName;
      baseName = baseName.replace(/\d{3}$/, '').replace(/Response$/i, '');
      newName = applyNamingConvention(baseName, convention);
      if (!newName.endsWith('Response')) {
        newName = newName + 'Response';
      }
    } else {
      newName = originalName;
    }

    let uniqueName = newName;
    let counter = 1;
    while (usedNames.has(uniqueName)) {
      uniqueName = newName.replace(/Response$/, '') + counter + 'Response';
      counter++;
    }
    usedNames.add(uniqueName);

    normalizedResponses[uniqueName] = content;
    
    responseMapping[uniqueName] = {
      folder: 'responses',
      fileName: uniqueName,
      statusCode,
      original: originalName,
    };

    if (uniqueName !== originalName) {
      refMapping[`#/components/responses/${originalName}`] = `#/components/responses/${uniqueName}`;
    }
  }

  return { normalizedResponses, responseMapping, refMapping };
}

// =============================================================================
// FUNCIÓN PRINCIPAL: TRANSFORM
// =============================================================================

/**
 * Transforma un OpenAPI según el scaffolding seleccionado
 * 
 * @param {Object} openapi - Documento OpenAPI parseado
 * @param {Object} options
 * @param {string} [options.scaffolding='standard'] - Nombre del scaffolding
 * @param {string} [options.style=null] - Forzar estilo (si no, auto-detecta)
 * @param {Object} [options.namingConfig] - Configuración de naming
 * @returns {Object} { openapi, schemaMapping, responseMapping, requestBodyMapping, detectedStyle, stats }
 */
function transform(openapi, options = {}) {
  const scaffoldingName = options.scaffolding || 'standard';
  const scaffolding = getScaffolding(scaffoldingName);
  const namingConfig = options.namingConfig || { components: 'PascalCase', paths: 'kebab-case' };

  const scaffoldings = loadScaffoldings();
  const detectedStyle = options.style || detectApiStyle(openapi.paths, scaffoldings).style;
  
  const transformed = JSON.parse(JSON.stringify(openapi));
  
  const stats = {
    schemasClassified: 0,
    responsesExtracted: 0,
    responsesNormalized: 0,
    requestBodiesNormalized: 0,
  };

  // 1. Clasificar y mapear schemas
  const schemaMapping = buildSchemaMapping(
    transformed.components?.schemas,
    scaffolding,
    namingConfig
  );
  stats.schemasClassified = Object.keys(schemaMapping).length;

  // 2. Normalizar responses existentes
  const { 
    normalizedResponses, 
    responseMapping: existingResponseMapping, 
    refMapping 
  } = normalizeExistingResponses(
    transformed.components?.responses,
    scaffolding,
    namingConfig
  );

  if (Object.keys(refMapping).length > 0) {
    let str = JSON.stringify(transformed);
    for (const [oldRef, newRef] of Object.entries(refMapping)) {
      const escaped = oldRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      str = str.replace(new RegExp(escaped, 'g'), newRef);
    }
    Object.assign(transformed, JSON.parse(str));
  }

  // 3. Extraer responses inline
  const { 
    transformedPaths, 
    extractedResponses, 
    responseMapping: inlineResponseMapping 
  } = extractInlineResponses(
    transformed.paths,
    scaffolding,
    detectedStyle,
    namingConfig
  );

  transformed.paths = transformedPaths;
  stats.responsesExtracted = Object.keys(extractedResponses).length;
  stats.responsesNormalized = Object.keys(existingResponseMapping).length;

  if (!transformed.components) transformed.components = {};
  transformed.components.responses = {
    ...normalizedResponses,
    ...extractedResponses,
  };

  const responseMapping = {
    ...existingResponseMapping,
    ...inlineResponseMapping,
  };

  // 4. Mapping de requestBodies
  const requestBodyMapping = {};
  if (transformed.components?.requestBodies) {
    for (const [name] of Object.entries(transformed.components.requestBodies)) {
      requestBodyMapping[name] = {
        folder: 'requestBodies',
        fileName: name.endsWith('Request') ? name : name + 'Request',
        original: name,
      };
    }
    stats.requestBodiesNormalized = Object.keys(requestBodyMapping).length;
  }

  return {
    openapi: transformed,
    schemaMapping,
    responseMapping,
    requestBodyMapping,
    detectedStyle,
    stats,
  };
}

// =============================================================================
// ANÁLISIS (sin transformar)
// =============================================================================

function analyze(openapi) {
  const scaffoldings = loadScaffoldings();
  const { style, confidence, scores } = detectApiStyle(openapi.paths, scaffoldings);

  const schemas = openapi.components?.schemas || {};
  const schemaStats = { objects: 0, enums: 0, arrays: 0, properties: 0, composites: 0 };
  
  for (const schema of Object.values(schemas)) {
    const type = classifySchema(schema);
    schemaStats[type]++;
  }

  let inlineResponses = 0;
  for (const pathObj of Object.values(openapi.paths || {})) {
    for (const [method, operation] of Object.entries(pathObj || {})) {
      if (!HTTP_METHODS.includes(method)) continue;
      for (const response of Object.values(operation?.responses || {})) {
        if (!response.$ref) inlineResponses++;
      }
    }
  }

  return {
    detectedStyle: style,
    confidence,
    scores,
    pathsCount: Object.keys(openapi.paths || {}).length,
    schemasCount: Object.keys(schemas).length,
    schemasByType: schemaStats,
    existingResponsesCount: Object.keys(openapi.components?.responses || {}).length,
    inlineResponsesCount: inlineResponses,
    requestBodiesCount: Object.keys(openapi.components?.requestBodies || {}).length,
    parametersCount: Object.keys(openapi.components?.parameters || {}).length,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  transform,
  analyze,
  classifySchema,
  buildSchemaMapping,
  extractInlineResponses,
  normalizeExistingResponses,
  inferEntityFromPath,
  inferActionFromPath,
  buildSmartResponseName,
  getScaffolding,
  loadScaffoldings, 
  SCHEMA_TYPES,
};
