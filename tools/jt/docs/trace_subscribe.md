# trace/subscribe
_source: https://open.jtjms-eg.com (chunk chunk-6ad0cfee, extracted 2026-09-20)_

**Description:** trackDescription_2

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
| `Id` | Number | Y |  | The api account ID of the access party on the platform |
| `list` | Object  | Y |  | Array |
| `traceNode` | String(32) | Y |  | Subscription node: 1&2&3&4&5&6&7&8&9&10&11&12&13&14&15 <p>1. express mail collection</p> <p>2. warehouse scanning (disabled)</p> <p>3. mail scanning</p> <p>4. to Scanning</p> <p>5. Scanning out of warehouse</p> <p>6. Inbound scanning</p> <p>7. Proxy revenue scan</p> <p>8. Express take out scanning</p> <p>9. Outbound scanning</p> <p>10. Signing for express mail</p> <p>11. Scanning for problems</p> <p>12. Warehousing of stored parts</p> <p>13. Return signature</p> <p>14. Return Scan</p> <p>15. Forward Scan</p> |
| `waybillCode` | String(32) | Y |  | Jitu Waybill Number |

## Response

### Response parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `code` | String | Y |  | Return code, see appendix |
| `msg` | String | Y |  | describe |
| `data` | Object | Y |  | Business data |

## requestCode
```json
header
apiAccoun=1001
digest=Zap4px/xcQEFIG0LgWGLcQ==
timestamp=1646984827998

bizContent={
  'id': '292508153084379141', 
  'list': [{'traceNode': '1&2&3&4&5&10&11', 'waybillCode': 'UEG000000190252'}]
  }
```

## Error codes
- `145013501` — The quantity of the waybill number exceeds 1000
- `145003100` — Illegal waybill number
