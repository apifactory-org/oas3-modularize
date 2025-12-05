# Scaffoldings por Estilo de API

## Dominio de ejemplo

Para comparar, usaremos el mismo dominio conceptual en cada estilo:
- **Entidad principal:** Employee (empleado)
- **Operaciones:** crear, obtener, listar, actualizar, eliminar, promover, notificar
- **Subrecursos:** salaries, contracts

---

## 1. Conservador (sin transformaciones)

> Preserva nombres exactos del OpenAPI original. Sin clasificación.

```
src/
├── main.yaml
├── paths/
│   ├── employees.yaml
│   ├── employees-{employeeId}.yaml
│   ├── employees-{employeeId}-salaries.yaml
│   └── employees-{employeeId}-contracts.yaml
└── components/
    ├── schemas/
    │   ├── Employee.yaml
    │   ├── EmployeeList.yaml
    │   ├── Salary.yaml
    │   ├── Contract.yaml
    │   ├── EmployeeStatus.yaml          # enum (sin separar)
    │   ├── ContractType.yaml            # enum (sin separar)
    │   └── Email.yaml                   # property (sin separar)
    ├── responses/
    │   ├── 200OkResponse.yaml           # nombres originales
    │   ├── 201CreatedResponse.yaml
    │   ├── 400BadRequest.yaml
    │   ├── 404NotFoundResponse.yaml
    │   └── 500InternalError.yaml
    ├── requestBodies/
    │   ├── EmployeeBody.yaml
    │   └── SalaryBody.yaml
    └── parameters/
        ├── employeeId.yaml
        └── pageSize.yaml
```

**Características:**
- Todo en carpetas planas
- Nombres tal cual vienen del OpenAPI
- Sin sufijos inteligentes
- Sin clasificación de schemas

---

## 2. RESTful

> Orientado a recursos. Clasificación de schemas. Nombres semánticos.

```
src/
├── main.yaml
├── paths/
│   ├── employees.yaml                    # GET (list), POST (create)
│   ├── employees-{employeeId}.yaml       # GET, PUT, PATCH, DELETE
│   ├── employees-{employeeId}-salaries.yaml
│   └── employees-{employeeId}-contracts.yaml
└── components/
    ├── schemas/                          # Entidades (type: object)
    │   ├── EmployeeSchema.yaml
    │   ├── SalarySchema.yaml
    │   └── ContractSchema.yaml
    ├── enums/                            # Enumeraciones
    │   ├── EmployeeStatusEnum.yaml       # active, inactive, terminated
    │   └── ContractTypeEnum.yaml         # permanent, temporary, contractor
    ├── properties/                       # Primitivos reutilizables
    │   ├── EmailProp.yaml
    │   ├── PhoneNumberProp.yaml
    │   └── CurrencyAmountProp.yaml
    ├── arrays/                           # Listas tipadas
    │   ├── EmployeeListArray.yaml
    │   └── SalaryHistoryArray.yaml
    ├── composites/                       # allOf, oneOf, anyOf
    │   └── EmployeeOrContractorSchema.yaml
    ├── responses/
    │   ├── CreateEmployeeResponse.yaml   # 201 POST /employees
    │   ├── RetrieveEmployeeResponse.yaml # 200 GET /employees/{id}
    │   ├── UpdateEmployeeResponse.yaml   # 200 PUT /employees/{id}
    │   ├── ListEmployeesResponse.yaml    # 200 GET /employees
    │   ├── DeleteEmployeeResponse.yaml   # 204 DELETE /employees/{id}
    │   ├── BadRequestResponse.yaml       # 400 (compartido)
    │   ├── NotFoundResponse.yaml         # 404 (compartido)
    │   └── InternalServerErrorResponse.yaml
    ├── requestBodies/
    │   ├── CreateEmployeeRequest.yaml
    │   ├── UpdateEmployeeRequest.yaml
    │   └── PatchEmployeeRequest.yaml
    └── parameters/
        ├── EmployeeIdParam.yaml
        ├── PageSizeParam.yaml
        └── SortByParam.yaml
```

**Patrón de nombres responses:** `{Verb}{Resource}Response`
| Método | Ruta | Response |
|--------|------|----------|
| GET | /employees | ListEmployeesResponse |
| GET | /employees/{id} | RetrieveEmployeeResponse |
| POST | /employees | CreateEmployeeResponse |
| PUT | /employees/{id} | UpdateEmployeeResponse |
| DELETE | /employees/{id} | DeleteEmployeeResponse |

---

## 3. RPC sobre HTTP

> Orientado a acciones. Verbos explícitos en paths.

```
src/
├── main.yaml
├── paths/
│   ├── employees.yaml                    # POST (create)
│   ├── employees-{employeeId}.yaml       # GET (retrieve)
│   ├── employees-{employeeId}-promote.yaml
│   ├── employees-{employeeId}-notify.yaml
│   ├── employees-{employeeId}-activate.yaml
│   ├── employees-{employeeId}-deactivate.yaml
│   ├── employees-{employeeId}-transfer.yaml
│   ├── employees-{employeeId}-salaries-calculate.yaml
│   ├── employees-search.yaml
│   ├── orders-{orderId}-approve.yaml
│   └── orders-{orderId}-reject.yaml
└── components/
    ├── schemas/                          # Sin subcarpetas (más simple)
    │   ├── EmployeeSchema.yaml
    │   ├── SalarySchema.yaml
    │   ├── PromotionResultSchema.yaml
    │   ├── NotificationResultSchema.yaml
    │   ├── TransferResultSchema.yaml
    │   └── SearchCriteriaSchema.yaml
    ├── enums/
    │   ├── EmployeeStatusEnum.yaml
    │   └── NotificationChannelEnum.yaml  # email, sms, push
    ├── responses/
    │   ├── CreateEmployeeResponse.yaml
    │   ├── RetrieveEmployeeResponse.yaml
    │   ├── PromoteEmployeeResponse.yaml  # POST /employees/{id}/promote
    │   ├── NotifyEmployeeResponse.yaml   # POST /employees/{id}/notify
    │   ├── ActivateEmployeeResponse.yaml
    │   ├── DeactivateEmployeeResponse.yaml
    │   ├── TransferEmployeeResponse.yaml
    │   ├── CalculateSalaryResponse.yaml
    │   ├── SearchEmployeesResponse.yaml
    │   ├── ApproveOrderResponse.yaml
    │   ├── RejectOrderResponse.yaml
    │   ├── BadRequestResponse.yaml
    │   └── NotFoundResponse.yaml
    ├── requestBodies/
    │   ├── CreateEmployeeRequest.yaml
    │   ├── PromoteEmployeeRequest.yaml
    │   ├── NotifyEmployeeRequest.yaml
    │   ├── TransferEmployeeRequest.yaml
    │   └── SearchEmployeesRequest.yaml
    └── parameters/
        ├── EmployeeIdParam.yaml
        └── OrderIdParam.yaml
```

**Patrón de nombres responses:** `{Action}{Resource}Response`
| Método | Ruta | Response |
|--------|------|----------|
| POST | /employees/{id}/promote | PromoteEmployeeResponse |
| POST | /employees/{id}/notify | NotifyEmployeeResponse |
| POST | /employees/{id}/activate | ActivateEmployeeResponse |
| POST | /employees/search | SearchEmployeesResponse |
| POST | /orders/{id}/approve | ApproveOrderResponse |

---

## 4. Google HTTP API (Custom Methods)

> Recursos + métodos custom con `:accion`. Híbrido CRUD + acciones.

```
src/
├── main.yaml
├── paths/
│   ├── v1-employees.yaml                 # GET (list), POST (create)
│   ├── v1-employees-{employeeId}.yaml    # GET, PUT, PATCH, DELETE
│   ├── v1-employees-batchGet.yaml        # POST :batchGet
│   ├── v1-employees-search.yaml          # GET :search
│   ├── v1-employees-{employeeId}-promote.yaml    # POST :promote
│   ├── v1-employees-{employeeId}-transfer.yaml   # POST :transfer
│   ├── v1-employees-{employeeId}-undelete.yaml   # POST :undelete
│   └── v1-documents-{documentId}-analyze.yaml    # POST :analyze
└── components/
    ├── schemas/
    │   ├── EmployeeSchema.yaml
    │   ├── SalarySchema.yaml
    │   └── DocumentSchema.yaml
    ├── enums/
    │   ├── EmployeeStatusEnum.yaml
    │   └── DocumentTypeEnum.yaml
    ├── properties/
    │   ├── EmailProp.yaml
    │   └── TimestampProp.yaml
    ├── arrays/
    │   └── EmployeeListArray.yaml
    ├── responses/
    │   │── # CRUD estándar
    │   ├── CreateEmployeeResponse.yaml
    │   ├── GetEmployeeResponse.yaml
    │   ├── UpdateEmployeeResponse.yaml
    │   ├── DeleteEmployeeResponse.yaml
    │   ├── ListEmployeesResponse.yaml
    │   │── # Custom methods
    │   ├── BatchGetEmployeesResponse.yaml    # :batchGet
    │   ├── SearchEmployeesResponse.yaml      # :search
    │   ├── PromoteEmployeeResponse.yaml      # :promote
    │   ├── TransferEmployeeResponse.yaml     # :transfer
    │   ├── UndeleteEmployeeResponse.yaml     # :undelete
    │   ├── AnalyzeDocumentResponse.yaml      # :analyze
    │   │── # Errores compartidos
    │   ├── BadRequestResponse.yaml
    │   ├── NotFoundResponse.yaml
    │   └── InternalServerErrorResponse.yaml
    ├── requestBodies/
    │   ├── CreateEmployeeRequest.yaml
    │   ├── UpdateEmployeeRequest.yaml
    │   ├── BatchGetEmployeesRequest.yaml
    │   ├── SearchEmployeesRequest.yaml
    │   ├── PromoteEmployeeRequest.yaml
    │   └── TransferEmployeeRequest.yaml
    └── parameters/
        ├── EmployeeIdParam.yaml
        ├── DocumentIdParam.yaml
        └── PageTokenParam.yaml
```

**Patrón de nombres responses:** `{Action}{Resource}Response`
| Método | Ruta | Response |
|--------|------|----------|
| POST | /v1/employees | CreateEmployeeResponse |
| POST | /v1/employees:batchGet | BatchGetEmployeesResponse |
| GET | /v1/employees:search | SearchEmployeesResponse |
| POST | /v1/employees/{id}:promote | PromoteEmployeeResponse |
| POST | /v1/documents/{id}:analyze | AnalyzeDocumentResponse |

---

## 5. BIAN Service Domain API

> Dominios bancarios. Control Records (CR) + Behavior Qualifiers (BQ).

```
src/
├── main.yaml
├── paths/
│   │── # Control Record (CR)
│   ├── party-reference-data-directory-register.yaml
│   ├── party-reference-data-directory-{crId}-retrieve.yaml
│   ├── party-reference-data-directory-{crId}-update.yaml
│   ├── party-reference-data-directory-{crId}-execute.yaml
│   │── # Behavior Qualifiers (BQ)
│   ├── party-reference-data-directory-{crId}-demographics-{bqId}-retrieve.yaml
│   ├── party-reference-data-directory-{crId}-demographics-{bqId}-update.yaml
│   ├── party-reference-data-directory-{crId}-demographics-{bqId}-exchange.yaml
│   ├── party-reference-data-directory-{crId}-bank-relations-{bqId}-retrieve.yaml
│   │── # Otro Service Domain
│   ├── card-authorization-{crId}-execute.yaml
│   └── loan-{crId}-fulfillment-arrangement-{bqId}-exchange.yaml
└── components/
    ├── schemas/
    │   │── # Control Records
    │   ├── PartyReferenceDataDirectorySchema.yaml
    │   ├── CardAuthorizationSchema.yaml
    │   ├── LoanSchema.yaml
    │   │── # Behavior Qualifiers
    │   ├── DemographicsSchema.yaml
    │   ├── BankRelationsSchema.yaml
    │   ├── FulfillmentArrangementSchema.yaml
    │   │── # Entidades de dominio
    │   ├── PartyIdentificationSchema.yaml
    │   └── AddressSchema.yaml
    ├── enums/
    │   ├── PartyTypeEnum.yaml            # individual, corporate
    │   ├── IdentificationTypeEnum.yaml   # DNI, passport, RUC
    │   ├── AuthorizationStatusEnum.yaml  # pending, approved, rejected
    │   └── LoanStatusEnum.yaml
    ├── responses/
    │   │── # CR Operations
    │   ├── RegisterPartyDirectoryResponse.yaml
    │   ├── RetrievePartyDirectoryResponse.yaml
    │   ├── UpdatePartyDirectoryResponse.yaml
    │   ├── ExecutePartyDirectoryResponse.yaml
    │   │── # BQ Operations
    │   ├── RetrieveDemographicsResponse.yaml
    │   ├── UpdateDemographicsResponse.yaml
    │   ├── ExchangeDemographicsResponse.yaml
    │   ├── RetrieveBankRelationsResponse.yaml
    │   │── # Otros Service Domains
    │   ├── ExecuteCardAuthorizationResponse.yaml
    │   ├── ExchangeFulfillmentArrangementResponse.yaml
    │   │── # Errores BIAN estándar
    │   ├── BadRequestResponse.yaml
    │   ├── UnauthorizedResponse.yaml
    │   ├── ForbiddenResponse.yaml
    │   ├── NotFoundResponse.yaml
    │   └── InternalServerErrorResponse.yaml
    ├── requestBodies/
    │   ├── RegisterPartyDirectoryRequest.yaml
    │   ├── UpdatePartyDirectoryRequest.yaml
    │   ├── ExecutePartyDirectoryRequest.yaml
    │   ├── UpdateDemographicsRequest.yaml
    │   ├── ExchangeDemographicsRequest.yaml
    │   └── ExecuteCardAuthorizationRequest.yaml
    └── parameters/
        ├── CrIdParam.yaml                # Control Record ID
        ├── BqIdParam.yaml                # Behavior Qualifier ID
        └── CollectionFilterParam.yaml
```

**Patrón de nombres responses:** `{Action}{CR|BQ}Response`
| Método | Ruta | Response |
|--------|------|----------|
| POST | /PartyReferenceDataDirectory/Register | RegisterPartyDirectoryResponse |
| GET | /PartyReferenceDataDirectory/{crId}/Retrieve | RetrievePartyDirectoryResponse |
| PUT | /.../{crId}/Demographics/{bqId}/Update | UpdateDemographicsResponse |
| POST | /.../{crId}/Demographics/{bqId}/Exchange | ExchangeDemographicsResponse |
| POST | /CardAuthorization/{crId}/Execute | ExecuteCardAuthorizationResponse |

---

## Comparativa de carpetas

| Carpeta | Conservador | RESTful | RPC | Google | BIAN |
|---------|-------------|---------|-----|--------|------|
| schemas/ | ✓ (todo) | ✓ | ✓ | ✓ | ✓ |
| enums/ | ✗ | ✓ | ✓ | ✓ | ✓ |
| properties/ | ✗ | ✓ | ✗ | ✓ | ✗ |
| arrays/ | ✗ | ✓ | ✗ | ✓ | ✗ |
| composites/ | ✗ | ✓ | ✗ | ✗ | ✗ |
| responses/ | ✓ | ✓ | ✓ | ✓ | ✓ |
| requestBodies/ | ✓ | ✓ | ✓ | ✓ | ✓ |
| parameters/ | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Patrón de nombres por estilo

| Estilo | Response 2xx | Request Body |
|--------|--------------|--------------|
| Conservador | `{original}` | `{original}` |
| RESTful | `{Verb}{Resource}Response` | `{Verb}{Resource}Request` |
| RPC | `{Action}{Resource}Response` | `{Action}{Resource}Request` |
| Google | `{Action}{Resource}Response` | `{Action}{Resource}Request` |
| BIAN | `{Action}{CR\|BQ}Response` | `{Action}{CR\|BQ}Request` |
