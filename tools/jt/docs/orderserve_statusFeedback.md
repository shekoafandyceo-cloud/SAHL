# (callback) orderserve/statusFeedback — J&T بتنده URL بتاعنا
_source: https://open.jtjms-eg.com (chunk chunk-53d9123b, extracted 2026-09-20)_

**Description:** OrderDescription_4

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
| `10000000001299` | String(32) | Y |  | Customer order number |
| `billCode` | String(32) | N |  | Jitu Waybill Number |
| `networkName` | String(32) | N |  | 网点名称（“已调派业务员”回传） |
| `pickStaffName` | String(32) | N |  | 业务员名称（“已调派业务员”回传） |
| `pickStaffPhone` | String(32) | N |  | Contact information of salesperson (returned by “deployed salesperson”) |
| `jtOrderId` | String(32) | Y |  | Jitu order number |
| `Weight` | String(32) | N |  | 重量（“已揽收”“已取件”时回传） |
| `reason` | String(32) | N |  | 订单取消原因（“已取消”时回传） |
| `scanType` | String(32) | Y |  | 状态(“已调派业务员”,“已揽收”，“已取件”，“已取消”) |
| `time` | String(32) | Y |  | time |
| `carrierCode` | String(32) | Y | JTSD | Carrier code |

## Response

### Response parameters

| name | type | req | example | describe |
|---|---|---|---|---|
| `code` | String | Y |  | Return code, see appendix |
| `msg` | String | Y |  | describe |
| `data` | String | Y |  | Business data |

## requestCode
```json
Header：
apiAccount=1362
digest=U40e5sumorgd3YgZzU61Mw==
timestamp=1565238848921

Body：
bizContent={
"billCode":"JT4000073746531",
"jtOrderId":"136072928692285467",
"networkName":"南京雨花台板桥网点",
"pickStaffName":"test0040",
"pickStaffPhone":"15110110110",
"scanType":"已调派业务员",
"time":"2020-06-03 18:44:34"
}

{
"billCode":"JT4000073746531",
"jtOrderId":"136072928692285467",
"scanType":"已入仓",
"time":"2020-06-03 18:48:51",
"weight":"2"
}

{
"billCode":"JT4000071327280",
"jtOrderId":"136074416353194043",
"reason":"客户取消订单",
"scanType":"已取消",
"time":"2020-06-03 18:52:01"
}
```

## Error codes
