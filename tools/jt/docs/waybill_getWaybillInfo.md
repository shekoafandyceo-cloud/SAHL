# waybill/getWaybillInfo
_source: https://open.jtjms-eg.com (chunk chunk-5ca8687f, extracted 2026-09-20)_

**Description:** OrderDescription_7

## Request

### Headers

| name | type | req | example | describe |
|---|---|---|---|---|
| `apiAccount` | Number | Y |  | The api account ID of the access party on the platform |
| `digest` | String | Y |  | Signature string |
| `timestamp` | Number | Y |  | Timestamp, milliseconds |

### Request parameter

| name | type | req | example | describe |
|---|---|---|---|---|
| `bizContent` | String | Y | Business parameters | The string type in json format in the business parameter module |

### Business parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `customerCode` | String(30) | Y | J0086474299 | Customer code (provided by contacting the shipping outlet) |
| `waybillNos` | Array | Y |  | waybillNum |

## Response

### Response parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `code` | String | Y |  | Return code, see appendix |
| `msg` | String | Y |  | describe |
| `data` | Object | Y |  | Business data |

### Data type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `waybillNo` | String | Y |  | Waybill number |
| `isSign` | Number | Y |  | Sign in status (1 yes, 0 no) |
| `packageChargeWeight` | BigDecimal | N |  | Waybill number |
| `totalFreight` | BigDecimal | N |  | Refer to the total freight (numerical type) |
| `freight` | BigDecimal | N |  | Reference waybill freight |

## requestCode
```json
Header：
    apiAccount=292508153084379141
    digest=5EJcbtDRjOvSj+uGThytpA==
    timestamp=1638429847416

Body：
    bizContent= {
'customerCode':'J0086024194',
'waybillNos':['UEG000000313474']
}
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": [
        {
            "waybillNo": "UEG000000313474",
            "customerCode": "J0086024194",
            "isSign": 1,
            "packageChargeWeight": 3.6,
            "totalFreight": 20,
            "freight": 20,
            "numberOfDispatch": 1
        }
    ]
}
```

## Error codes
