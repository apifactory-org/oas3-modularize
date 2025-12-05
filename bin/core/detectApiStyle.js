/**
 * =============================================================================
 * DETECT API STYLE — Detección heurística del estilo de API
 * =============================================================================
 *
 * Detecta automáticamente el estilo de una API analizando sus paths:
 *   - restful: Recursos plurales, métodos HTTP semánticos
 *   - rpc: Verbos de acción al final (notify, approve, reject)
 *   - google: Custom methods con :action
 *   - bian: Acciones BIAN (Register, Retrieve, Execute, Exchange)
 *
 * =============================================================================
 */

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'trace'];

// =============================================================================
// FUNCIONES DE ANÁLISIS
// =============================================================================

/**
 * Extrae todas las operations de los paths
 */
function collectOperations(paths) {
  const result = [];
  for (const [route, pathObj] of Object.entries(paths || {})) {
    if (!pathObj || typeof pathObj !== 'object') continue;
    for (const [method, op] of Object.entries(pathObj)) {
      if (!HTTP_METHODS.includes(method.toLowerCase())) continue;
      if (!op || typeof op !== 'object') continue;
      result.push({ path: route, method: method.toLowerCase(), op });
    }
  }
  return result;
}

/**
 * Devuelve los segmentos estáticos de un path (sin llaves ni versión)
 * /v1/users/{id}/notify → ["users", "notify"]
 */
function getStaticSegments(route) {
  return route
    .split('/')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('{') && !s.endsWith('}') && !/^v\d+$/i.test(s) && s !== 'api');
}

/**
 * Ratio de paths cuyo último segmento es un verbo conocido
 */
function computeVerbsAtEndRatio(paths, verbs) {
  if (!paths || Object.keys(paths).length === 0) return 0;
  if (!verbs || verbs.length === 0) return 0;

  const verbSet = new Set(verbs.map(v => v.toLowerCase()));
  let total = 0;
  let matched = 0;

  for (const route of Object.keys(paths)) {
    const segments = getStaticSegments(route);
    if (segments.length === 0) continue;
    total++;
    
    let last = segments[segments.length - 1].toLowerCase();
    // Remover prefijo : de Google style
    if (last.startsWith(':')) {
      last = last.substring(1);
    }
    
    if (verbSet.has(last)) {
      matched++;
    }
  }

  return total === 0 ? 0 : matched / total;
}

/**
 * Ratio de paths con recursos plurales (terminan en 's')
 */
function computePluralResourcesRatio(paths) {
  if (!paths || Object.keys(paths).length === 0) return 0;

  let total = 0;
  let plural = 0;

  for (const route of Object.keys(paths)) {
    const segments = getStaticSegments(route);
    if (segments.length === 0) continue;

    // Primer segmento como recurso
    const resource = segments[0];
    total++;

    if (resource.toLowerCase().endsWith('s') && !resource.toLowerCase().endsWith('ss')) {
      plural++;
    }
  }

  return total === 0 ? 0 : plural / total;
}

/**
 * Ratio de paths con custom methods estilo Google (:action)
 */
function computeCustomMethodsRatio(paths, pattern = ':\\w+') {
  if (!paths || Object.keys(paths).length === 0) return 0;

  const regex = new RegExp(pattern);
  let total = 0;
  let matched = 0;

  for (const route of Object.keys(paths)) {
    total++;
    if (regex.test(route)) {
      matched++;
    }
  }

  return total === 0 ? 0 : matched / total;
}

/**
 * Ratio de segmentos que parecen verbos dentro del path
 */
function computeVerbsInPathRatio(paths, verbPrefixes = ['get', 'create', 'update', 'delete', 'patch']) {
  if (!paths || Object.keys(paths).length === 0) return 0;

  const verbs = verbPrefixes.map(v => v.toLowerCase());
  let totalSegments = 0;
  let verbSegments = 0;

  for (const route of Object.keys(paths)) {
    const segments = getStaticSegments(route);
    for (const seg of segments) {
      totalSegments++;
      const lower = seg.toLowerCase().replace(/^:/, '');
      if (verbs.some(v => lower.startsWith(v))) {
        verbSegments++;
      }
    }
  }

  return totalSegments === 0 ? 0 : verbSegments / totalSegments;
}

/**
 * Ratio de operationIds que matchean patrones dados
 */
function computeOperationIdPatternRatio(paths, regexPatterns) {
  if (!paths || Object.keys(paths).length === 0) return 0;
  if (!Array.isArray(regexPatterns) || regexPatterns.length === 0) return 0;

  const ops = collectOperations(paths);
  if (ops.length === 0) return 0;

  const regexes = regexPatterns.map(p => new RegExp(p, 'i'));
  let total = 0;
  let matched = 0;

  for (const { op } of ops) {
    const opId = op.operationId;
    if (!opId || typeof opId !== 'string') continue;
    total++;
    if (regexes.some(r => r.test(opId))) {
      matched++;
    }
  }

  return total === 0 ? 0 : matched / total;
}

// =============================================================================
// MOTOR PRINCIPAL DE DETECCIÓN
// =============================================================================

/**
 * Detecta el estilo de API analizando los paths
 *
 * @param {Object} paths - Sección paths del OpenAPI
 * @param {Object} scaffoldings - Configuración de scaffoldings con reglas de detección
 * @returns {Object} { style: string, confidence: number, scores: Object }
 */
function detectApiStyle(paths, scaffoldings = {}) {
  const results = [];

  for (const [styleName, config] of Object.entries(scaffoldings)) {
    const detection = config.detection;
    
    // Saltar si la detección está deshabilitada
    if (!detection || detection.enabled === false) continue;

    let score = 0;
    let checks = 0;

    // 1. Verbos al final (BIAN, RPC)
    if (detection.verbsAtEnd) {
      checks++;
      const verbs = detection.verbsAtEnd.values || [];
      const minRatio = detection.verbsAtEnd.minRatio ?? 0;
      const ratio = computeVerbsAtEndRatio(paths, verbs);
      if (ratio >= minRatio) {
        score += ratio;
      }
    }

    // 2. Recursos plurales (RESTful)
    if (detection.pluralResources) {
      checks++;
      const minRatio = detection.pluralResources.minRatio ?? 0;
      const ratio = computePluralResourcesRatio(paths);
      if (ratio >= minRatio) {
        score += ratio;
      }
    }

    // 3. Custom methods :action (Google)
    if (detection.customMethods) {
      checks++;
      const pattern = detection.customMethods.pattern || ':\\w+';
      const minRatio = detection.customMethods.minRatio ?? 0;
      const ratio = computeCustomMethodsRatio(paths, pattern);
      if (ratio >= minRatio) {
        score += ratio * 1.5; // Bonus para custom methods (muy distintivo)
      }
    }

    // 4. Verbos en el path (anti-REST)
    if (detection.verbsInPath) {
      checks++;
      const maxRatio = detection.verbsInPath.maxRatio ?? 1;
      const prefixes = detection.verbsInPath.verbPrefixes;
      const ratio = computeVerbsInPathRatio(paths, prefixes);
      if (ratio <= maxRatio) {
        score += (1 - ratio);
      }
    }

    // 5. Patrones en operationId
    if (detection.operationIdPatterns) {
      checks++;
      const patterns = detection.operationIdPatterns;
      const minRatio = detection.operationIdPatternsMinRatio ?? 0.2;
      const ratio = computeOperationIdPatternRatio(paths, patterns);
      if (ratio >= minRatio) {
        score += ratio;
      }
    }

    // Normalizar score
    const normalizedScore = checks > 0 ? score / checks : 0;

    results.push({ 
      style: styleName, 
      score: normalizedScore,
      rawScore: score,
      checks,
    });
  }

  if (results.length === 0) {
    return { style: 'standard', confidence: 0, scores: {} };
  }

  // Ordenar por score descendente
  results.sort((a, b) => b.score - a.score);
  
  const top = results[0];
  const scores = {};
  for (const r of results) {
    scores[r.style] = Math.round(r.score * 100);
  }

  // Calcular confianza (diferencia con el segundo)
  const confidence = results.length > 1 
    ? Math.min(100, Math.round((top.score - results[1].score) * 100 + 50))
    : 100;

  return {
    style: top.score > 0 ? top.style : 'standard',
    confidence,
    scores,
  };
}

/**
 * Versión simplificada que solo retorna el nombre del estilo
 */
function detectApiStyleName(paths, scaffoldings = {}) {
  const result = detectApiStyle(paths, scaffoldings);
  return result.style;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  detectApiStyle,
  detectApiStyleName,
  collectOperations,
  computeVerbsAtEndRatio,
  computePluralResourcesRatio,
  computeCustomMethodsRatio,
  computeVerbsInPathRatio,
  computeOperationIdPatternRatio,
  getStaticSegments,
};