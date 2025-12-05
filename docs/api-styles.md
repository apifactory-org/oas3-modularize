# Catálogo de Estilos REST y Derivados

---

## I) Introducción

### Propósito

Este catálogo documenta los principales estilos arquitectónicos para el diseño de APIs basadas en HTTP, desde el modelo teórico REST definido por Roy Fielding hasta las adaptaciones pragmáticas utilizadas en la industria.

### Audiencia

- Arquitectos de software
- Desarrolladores de APIs
- Equipos de integración
- Comités de gobernanza de APIs

### Estilos cubiertos

1. REST (Roy Fielding)
2. RESTful (Industria)
3. RPC sobre HTTP
4. Google HTTP API (Custom Methods con ":")
5. BIAN Service Domain API

| Estilo | Origen | Enfoque principal |
|--------|--------|-------------------|
| REST (Fielding) | Académico (tesis doctoral, 2000) | Arquitectura de sistemas distribuidos hipermedia |
| RESTful (Industria) | Pragmático | APIs orientadas a recursos con HTTP |
| RPC sobre HTTP | Tradicional | Invocación remota de procedimientos |
| Google HTTP API | Google API Design Guide | Recursos + métodos personalizados |
| BIAN | Banking Industry Architecture Network | Dominios de servicio bancario |

---

## 1. Estilo REST (Roy Fielding)

### Definición

REST (Representational State Transfer) es un estilo arquitectónico definido por Roy Fielding en su tesis doctoral de 2000. No es una especificación ni un protocolo, sino un conjunto de restricciones arquitectónicas para sistemas hipermedia distribuidos.

### Restricciones fundamentales

| Restricción | Descripción |
|-------------|-------------|
| Cliente-Servidor | Separación de responsabilidades entre UI y almacenamiento de datos |
| Sin estado (Stateless) | Cada petición contiene toda la información necesaria; el servidor no almacena contexto de sesión |
| Caché | Las respuestas deben indicar si son cacheables para mejorar eficiencia |
| Interfaz uniforme | Identificación de recursos, manipulación mediante representaciones, mensajes autodescriptivos, HATEOAS |
| Sistema en capas | Arquitectura jerárquica donde cada capa solo conoce la capa adyacente |
| Código bajo demanda (opcional) | El servidor puede extender funcionalidad del cliente enviando código ejecutable |

### HATEOAS (Hypermedia as the Engine of Application State)

Es el elemento más distintivo y menos implementado de REST puro. Significa que el cliente navega la API únicamente a través de hipervínculos provistos dinámicamente por el servidor.

### Tabla de ejemplos

| Tipo de operación | Método HTTP | Endpoint | Respuesta incluye |
|-------------------|-------------|----------|-------------------|
| Obtener recurso | GET | `/employees/123` | Representación + enlaces a acciones posibles |
| Crear recurso | POST | `/employees` | Nueva representación + enlace al recurso creado |
| Actualizar recurso | PUT | `/employees/123` | Representación actualizada + enlaces |
| Eliminar recurso | DELETE | `/employees/123` | Confirmación + enlace a colección |
| Navegar colección | GET | `/employees` | Lista + enlaces de paginación + enlaces a cada recurso |

### Ejemplo de respuesta HATEOAS

```json
{
  "employeeId": "123",
  "name": "Ana García",
  "department": "Engineering",
  "_links": {
    "self": { "href": "/employees/123" },
    "promote": { "href": "/employees/123/promotions", "method": "POST" },
    "department": { "href": "/departments/engineering" },
    "manager": { "href": "/employees/456" }
  }
}
```

### Características clave

| Característica | Valor |
|----------------|-------|
| Verbos en URLs | Prohibidos |
| Descubrimiento de API | Mediante hipermedia (no documentación externa) |
| Acoplamiento cliente-servidor | Mínimo (loose coupling) |
| Tipos de medios | Fundamentales (application/hal+json, application/vnd.api+json) |

---

## 2. Estilo RESTful (Industria)

### Definición

El estilo RESTful representa la interpretación pragmática de REST adoptada por la industria. Conserva la orientación a recursos y el uso semántico de métodos HTTP, pero relaja o ignora restricciones como HATEOAS. Es el estilo más común en APIs comerciales.

### Principios adoptados

| Principio | Implementación típica |
|-----------|----------------------|
| Recursos identificables | URLs sustantivas que representan entidades |
| Métodos HTTP semánticos | GET (leer), POST (crear), PUT/PATCH (actualizar), DELETE (eliminar) |
| Sin estado | Autenticación via tokens (JWT, API keys) en cada petición |
| Representaciones | JSON como formato dominante |
| Códigos de estado HTTP | Uso consistente (200, 201, 400, 404, 500, etc.) |

### Principios relajados o ignorados

| Principio REST | Estado en RESTful |
|----------------|-------------------|
| HATEOAS | Raramente implementado |
| Tipos de medios personalizados | Poco frecuente |
| Descubrimiento por hipermedia | Reemplazado por documentación (OpenAPI/Swagger) |
| Código bajo demanda | No utilizado |

### Tabla de ejemplos

| Tipo de operación | Método HTTP | Endpoint | Descripción |
|-------------------|-------------|----------|-------------|
| Listar recursos | GET | `/api/v1/employees` | Retorna colección de empleados |
| Obtener recurso | GET | `/api/v1/employees/{id}` | Retorna empleado específico |
| Crear recurso | POST | `/api/v1/employees` | Crea nuevo empleado |
| Actualizar completo | PUT | `/api/v1/employees/{id}` | Reemplaza empleado completo |
| Actualizar parcial | PATCH | `/api/v1/employees/{id}` | Modifica campos específicos |
| Eliminar recurso | DELETE | `/api/v1/employees/{id}` | Elimina empleado |
| Filtrar colección | GET | `/api/v1/employees?department=sales&status=active` | Búsqueda con query params |
| Recurso anidado | GET | `/api/v1/employees/{id}/contracts` | Subrecursos relacionados |

### Convenciones comunes

| Aspecto | Convención |
|---------|------------|
| Versionado | En URL (`/v1/`) o header (`Accept-Version`) |
| Paginación | Query params (`?page=2&limit=20`) o cursor-based |
| Ordenamiento | Query params (`?sort=name,-createdAt`) |
| Filtrado | Query params con operadores (`?salary[gte]=50000`) |
| Expansión de relaciones | Query params (`?include=department,manager`) |
| Formato de respuesta | Envoltura consistente (`{ "data": [], "meta": {} }`) |

### Ejemplo de respuesta típica

```json
{
  "data": {
    "id": "123",
    "type": "employee",
    "attributes": {
      "name": "Ana García",
      "email": "ana.garcia@empresa.com",
      "department": "sales"
    }
  },
  "meta": {
    "requestId": "abc-123",
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

---

## 3. Estilo RPC sobre HTTP

### Definición

RPC (Remote Procedure Call) sobre HTTP es un estilo orientado a acciones donde las URLs representan operaciones o procedimientos a ejecutar, no recursos. El verbo de la acción se incluye explícitamente en la URL, y típicamente se usa POST para todas las operaciones que modifican estado.

### Características principales

| Característica | Descripción |
|----------------|-------------|
| Orientación | Acciones/procedimientos, no recursos |
| URLs | Contienen verbos que describen la operación |
| Método HTTP | Predomina POST para operaciones; GET solo para consultas |
| Semántica | La URL describe QUÉ hacer, el body contiene los parámetros |
| Acoplamiento | Alto entre cliente y servidor |

### Tabla de ejemplos

| Tipo de operación | Método HTTP | Endpoint | Descripción |
|-------------------|-------------|----------|-------------|
| Notificar empleado | POST | `/employees/{employeeId}/notify` | Envía notificación al empleado |
| Activar cuenta | POST | `/employees/{employeeId}/activate` | Activa la cuenta del empleado |
| Desactivar cuenta | POST | `/employees/{employeeId}/deactivate` | Desactiva la cuenta del empleado |
| Promover empleado | POST | `/employees/{employeeId}/promote` | Promueve al empleado |
| Transferir empleado | POST | `/employees/{employeeId}/transfer` | Transfiere a otro departamento |
| Calcular salario | POST | `/employees/{employeeId}/salaries/calculate` | Calcula el salario del empleado |
| Aprobar orden | POST | `/orders/{orderId}/approve` | Aprueba una orden |
| Rechazar orden | POST | `/orders/{orderId}/reject` | Rechaza una orden |
| Buscar empleados | POST | `/employees/search` | Búsqueda con criterios complejos |
| Generar reporte | POST | `/reports/generate` | Genera un reporte |
| Eliminar correos no leídos | POST | `/unread-emails/delete` | Elimina todos los correos sin leer |
| Archivar contratos vencidos | POST | `/expired-contracts/archive` | Archiva contratos expirados |

### Variantes de RPC sobre HTTP

| Variante | Descripción | Ejemplo |
|----------|-------------|---------|
| RPC puro | URLs son solo nombres de procedimientos | `POST /notifyEmployee` |
| RPC híbrido | Combina recurso + acción | `POST /employees/123/notify` |
| JSON-RPC | Protocolo estandarizado sobre HTTP | `POST /jsonrpc` con método en body |
| XML-RPC | Protocolo legacy sobre HTTP | `POST /xmlrpc` con método en XML |

### Ejemplo de petición RPC híbrido

```http
POST /employees/{employeeId}/notify HTTP/1.1
Content-Type: application/json

{
  "subject": "Actualización de contrato",
  "message": "Tu contrato ha sido renovado",
  "channel": "email",
  "priority": "high"
}
```

### Ejemplo de respuesta

```json
{
  "success": true,
  "notificationId": "notif-789",
  "sentAt": "2024-01-15T10:30:00Z",
  "channel": "email"
}
```

### Cuándo usar RPC sobre HTTP

| Escenario | Justificación |
|-----------|---------------|
| Operaciones que no mapean a CRUD | Acciones como "aprobar", "rechazar", "notificar" |
| Procesos de negocio complejos | Workflows con múltiples pasos |
| Comandos sin recurso claro | Operaciones del sistema como "limpiarCache" |
| Integración con sistemas legacy | Sistemas que ya exponen procedimientos |
| APIs internas de microservicios | Comunicación directa entre servicios |

### Ventajas y desventajas

| Ventajas | Desventajas |
|----------|-------------|
| Intuitivo para desarrolladores | No aprovecha semántica HTTP |
| Mapea bien a funciones de código | Difícil de cachear |
| Flexible para operaciones complejas | Alto acoplamiento cliente-servidor |
| Fácil de documentar | No es autodescriptivo |

---

## 4. Estilo Google HTTP API (Custom Methods)

### Definición

El estilo de diseño de Google para APIs HTTP (recogido en la Google API Design Guide) combina un enfoque fuertemente orientado a recursos con "métodos personalizados" que se expresan añadiendo un sufijo `:accion` al recurso. Esto permite mantener URLs centradas en recursos y, al mismo tiempo, modelar operaciones que no encajan bien en CRUD clásico.

Los métodos personalizados pueden colgar de una colección o de un recurso individual, por ejemplo:

* `/v1/employees:search`
* `/v1/documents/{document_id}:analyze`

### Tabla de ejemplos

| Tipo de operación | Método HTTP | Endpoint | Descripción |
|-------------------|-------------|----------|-------------|
| Crear recurso (CRUD) | POST | `/v1/employees` | Crea un nuevo empleado |
| Obtener recurso (CRUD) | GET | `/v1/employees/{employee_id}` | Recupera un empleado específico |
| Búsqueda avanzada (método personalizado en colección) | GET | `/v1/employees:search` | Ejecuta una búsqueda avanzada de empleados |
| Operación batch (método personalizado en colección) | POST | `/v1/employees:batchGet` | Recupera múltiples empleados en una sola llamada |
| Acción sobre un recurso (método personalizado en recurso) | POST | `/v1/employees/{employee_id}:promote` | Promueve a un empleado a un nuevo cargo |

### Métodos personalizados comunes

| Método | Verbo HTTP | Uso típico |
|--------|------------|------------|
| `:search` | GET | Búsquedas complejas que no encajan en filtros simples |
| `:batchGet` | POST | Obtener múltiples recursos por IDs |
| `:batchCreate` | POST | Crear múltiples recursos en una operación |
| `:batchUpdate` | POST | Actualizar múltiples recursos |
| `:batchDelete` | POST | Eliminar múltiples recursos |
| `:move` | POST | Mover recurso a otra ubicación/padre |
| `:copy` | POST | Duplicar un recurso |
| `:cancel` | POST | Cancelar una operación en curso |
| `:undelete` | POST | Restaurar recurso eliminado |

---

## 5. Estilo BIAN Service Domain API

### Definición

BIAN organiza APIs por dominios bancarios. Cada dominio tiene un Control Record (CR) y múltiples Behavior Qualifiers (BQ). Las operaciones se expresan como acciones explícitas.

### Tabla de ejemplos

| Concepto BIAN | Método HTTP | Endpoint | Descripción |
|---------------|-------------|----------|-------------|
| Registrar CR | POST | `/PartyReferenceDataDirectory/Register` | Crea un nuevo control record |
| Recuperar CR | GET | `/PartyReferenceDataDirectory/{crId}/Retrieve` | Obtiene el CR |
| Actualizar BQ | PUT | `/PartyReferenceDataDirectory/{crId}/Demographics/{bqId}/Update` | Actualiza datos demográficos |
| Intercambio operativo | POST | `/Loan/{crId}/FulfillmentArrangement/{bqId}/Exchange` | Operación de intercambio BQ |
| Ejecución | POST | `/CardAuthorization/{crId}/Execute` | Solicita ejecución de operación |

### Acciones estándar BIAN

| Acción | Método HTTP | Propósito |
|--------|-------------|-----------|
| Initiate | POST | Inicia un nuevo CR/BQ |
| Register | POST | Registra información en el dominio |
| Create | POST | Crea un componente dentro de un CR activo |
| Evaluate | POST | Evalúa/valora algo (ej: riesgo crediticio) |
| Provide | POST | Provee información o servicio |
| Update | PUT | Actualiza información existente |
| Control | PUT | Modifica comportamiento operativo |
| Exchange | POST | Intercambio de información entre dominios |
| Execute | POST | Ejecuta una acción/transacción |
| Request | POST | Solicita una acción que requiere aprobación |
| Retrieve | GET | Obtiene información |
| Notify | POST | Envía notificación |
| Capture | POST | Captura información de evento |

---

## II) Comparación general

| Criterio | REST | RESTful | RPC | Google HTTP API | BIAN |
|----------|------|---------|-----|-----------------|------|
| Nivel de rigor académico | Muy alto | Medio | Bajo | Medio | No REST |
| Verbos en rutas | Prohibidos | Permitidos en casos | Siempre | Evitados (usa `:accion`) | Comunes |
| HATEOAS | Requerido | Opcional | No aplica | No aplica | No aplica |
| Enfoque | Recursos e hipermedia | Recursos + acciones | Acciones/procedimientos | CRUD + métodos custom | Dominio bancario |
| Método HTTP principal | Semántico (GET, POST, PUT, DELETE) | Semántico | POST predominante | Semántico + POST para custom | POST predominante |
| Descubrimiento | Por hipermedia | Por documentación | Por documentación | Por documentación | Por especificación BIAN |
| Curva de aprendizaje | Alta | Media | Baja | Media | Alta |
| Cacheabilidad | Alta | Media | Baja | Media | Baja |
| Adecuado para banca | Limitado | Posible | Posible | Posible | Ideal |
| Adecuado para CRUD | No es su foco | Sí | No | Sí | No |
| Adecuado para acciones complejas | No | Parcial | Sí | Sí | Sí |

---

## III) Cuándo usar cada estilo

| Escenario | Estilo recomendado |
|-----------|-------------------|
| Sistema hipermedia puro con máxima evolucionabilidad | REST (Fielding) |
| APIs comerciales de propósito general | RESTful |
| Operaciones que no mapean a CRUD (aprobar, rechazar, notificar) | RPC o Google HTTP API |
| APIs con operaciones complejas más allá de CRUD | Google HTTP API |
| Integración en ecosistema bancario estandarizado | BIAN |
| Microservicios internos con operaciones simples | RESTful |
| Microservicios internos orientados a comandos | RPC |
| APIs públicas para desarrolladores externos | RESTful o Google HTTP API |
| Sistemas legacy o integración con SOAP | RPC |

---

Si deseas extender este catálogo, agregar estilos adicionales, incorporar ejemplos OpenAPI o generar versiones automatizadas para tu modularizador, puedo hacerlo.