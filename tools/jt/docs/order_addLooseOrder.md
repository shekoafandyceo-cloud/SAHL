# order/addLooseOrder
_source: https://open.jtjms-eg.com (chunk chunk-79f0eb48, extracted 2026-09-20)_

**Description:** OrderDescription_5

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
| `salesmanCode` | String(30) | N |  | Salesman code (provided by contacting the shipping outlet, and signed by the outlet code) |
| `digest` | String(50) | N |  | Signature, Base64 (Md5 (customer code/salesman code+ciphertext+privateKey)), where the ciphertext: MD5 (plaintext password/point code+jadada236t2) followed by capital |
| `billCode` | String(50) | N |  | Waybill number |
| `10000000001299` | String(50) | Y |  | Customer order number (pass the order number of the customer’s own system) |
| `expressType` | String(30) | Y |  | Express type: EZ (standard express) |
| `orderType` | String(11) | Y |  | 订单类型  1、散客；    |
| `serviceType` | String(30) | Y |  | 服务类型    02 门店寄件 01 上门取件 |
| `deliveryType` | String(30) | Y |  | 派送类型  06 代收点自提  05 快递柜自提  04 站点自提  03 派送上门  |
| `payType` | String(30) | N |  | 支付方式CC_CASH(“到付现结”);PP_CASH（“寄付现结”） |
| `sender` | Object | Y |  | Shipment information object |
| `receiver` | Object | Y |  | Receiving information object |
| `sendStartTime` | String(30) | N |  | 物流公司上门取货开始时间 yyyy-MM-dd HH:mm:ss |
| `sendEndTime` | String(30) | N |  | The end time of the logistics company's pick-up yyyy-MM-dd HH:mm:ss |
| `goodsType` | String(30) | Y |  | 物品类型（对应订单主表物品类型）:<p>bm000001 文件</p>  <p>bm000002 数码产品</p>  <p>bm000003 生活用品</p>  <p>bm000004  食品</p>  <p>bm000005  服饰</p>  <p>bm000006  其他</p>  <p>bm000007 生鲜类</p>  <p>bm000008 易碎品</p><p>bm000009 液体</p> |
| `length` | int(6) | N |  | 长，cm |
| `width` | int(6) | N |  | 宽，cm |
| `height` | int(6) | N |  | 高，cm |
| `weight` | String(12) | N | 0.02 | 重量，单位kg，范围0.01-30 |
| `totalQuantity` | int(4) | N |  | Total number of tickets for the package (must be 1) |
| `itemsValue` | String(12) | N |  | Amount of payment (numeric) |
| `priceCurrency` | String(32) | N |  | 代收货款币别（默认本国币别，如：RMB |
| `offerFee` | String(12) | N |  | 保价金额(数值型)，单位：元 |
| `remark` | String(200) | N |  | Remark |
| `items` | Object | N |  | Product information list |

### sender type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `zhangsan` | String(32) | Y |  | Sender name |
| `company` | String(100) | N |  | Shipping company |
| `postCode` | String(32) | N |  | Shipping zip code |
| `mailBox` | String(150) | N |  | Sending mailbox |
| `mobile` | String(30) | Y |  | 寄件手机（手机和电话二选一必填） |
| `phone` | String(30) | Y |  | 寄件电话（手机和电话二选一必填） |
| `countryCode` | String(20) | Y |  | 寄件国家三字码（如：中国=CHN、印尼=IDN） |
| `prov` | String(32) | Y |  | Sending province |
| `city` | String(32) | Y |  | Sending city |
| `area` | String(32) | Y |  | Shipping area |
| `town` | String(32) | N |  | 寄件乡镇 |
| `street` | String(32) | N |  | Sending street |
| `address` | String(150) | Y |  | 寄件详细地址（省+市+区县+详细地址） |

### Receiver type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `zhangsan` | String(32) | Y |  | The recipient's name |
| `company` | String(100) | N |  | receiver |
| `postCode` | String(32) | N |  | Receiving postal code |
| `mailBox` | String(150) | N |  | Receiving mailbox |
| `mobile` | String(30) | Y |  | 收件手机（手机和电话二选一必填） |
| `phone` | String(30) | Y |  | 收件电话（手机和电话二选一必填） |
| `countryCode` | String(20) | Y |  | 收件国家三字码（如：中国=CHN、印尼=IDN） |
| `prov` | String(32) | Y |  | Receiving province |
| `city` | String(32) | Y |  | Receiving city |
| `area` | String(32) | Y |  | Receiving area |
| `town` | String(32) | N |  | 收件乡镇 |
| `street` | String(32) | N |  | Receiving street |
| `address` | String(150) | Y |  | 收件详细地址（省+市+区县+详细地址） |

### Item type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `itemType` | String(30) | N |  | 物品类型: <p>bm000001 文件</p>  <p>bm000002 数码产品</p>  <p>bm000003 生活用品</p>  <p>bm000004  食品</p>  <p>bm000005  服饰</p>  <p>bm000006  其他</p>  <p>bm000007 生鲜类</p>  <p>bm000008 易碎品</p><p>bm000009 液体</p> |
| `itemName` | String(30) | N |  | Item Name |
| `chineseName` | String(60) | N |  | Chinese name of the item |
| `englishName` | String(60) | N |  | English name of the item |
| `number` | int(4) | N |  | 件数，≤1 |
| `itemValue` | String(20) | N |  | Declared value (numerical type) |
| `priceCurrency` | String(20) | N |  | 申报货款币别（默认本国币别，如：RMB） |
| `desc` | String(100) | N |  | item description |
| `itemUrl` | String(100) | N |  | Product URL |

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
| `10000000001299` | String | Y |  | Return customer order number |
| `orderId` | String | Y |  | 返回极兔订单号 |
| `createOrderTime` | String | Y |  | 订单创建时间 yyyy-MM-dd HH:mm:ss |

## requestCode
```json
Header：
    apiAccount=1627
    digest=U40e5sumorgd3YgZzU61Mw==
    timestamp=1565238848921

Body：
    bizContent={
{
\t"txlogisticId": "10000000001299",
\t"orderType": 1,
\t"expressType": "EZ",
\t"serviceType": "01",
\t"deliveryType": "03",
\t"sender": {
\t\t"name": "李白",
\t\t"company": "天美工作室",
\t\t"postCode": "518000",
\t\t"mailBox": "ant_li@qq.com",
\t\t"mobile": "13421747372",
\t\t"phone": "",
\t\t"countryCode": "CHN",
\t\t"prov": "山东省",
\t\t"city": "淄博",
\t\t"area": "沂源县",
\t\t"town": "南山区",
\t\t"street": "粤海街道",
\t\t"address": "粤美特大厦"
\t},
\t"receiver": {
\t\t"name": "高渐离",
\t\t"company": "天美工作室",
\t\t"postCode": "518000",
\t\t"mailBox": "ant_li@qq.com",
\t\t"mobile": "13421747372",
\t\t"phone": "",
\t\t"countryCode": "CHN",
\t\t"prov": "山东省",
\t\t"city": "淄博",
\t\t"area": "沂源县",
\t\t"town": "南山区",
\t\t"street": "粤海街道",
\t\t"address": "粤美特大厦"
\t},
\t"sendStartTime": "2019-08-06 15:00:00",
\t"sendEndTime": "2019-08-06 15:30:00",
\t"goodsType": "bm000001",
\t"length": 50,
\t"width": 50,
\t"height": 1,
\t"volume": 250,
\t"weight": 1,
\t"totalQuantity": 1,
\t"itemsValue": "200",
\t"priceCurrency": "RMB",
"payType":"CC_CASH",
\t"offerFee": "200000",
\t"remark": "重要文件",
\t"createOrderTime": "2019-08-06 15:30:00",
\t"items": [{
\t\t"itemType": "文件",
\t\t"itemName": "文件",
\t\t"chineseName": "文件C",
\t\t"englishName": "文件E",
\t\t"Number()": "1",
\t\t"itemValue": "200000",
\t\t"priceCurrency": "RMB",
\t\t"desc": "文件",
\t\t"itemUrl": ""
\t}]
}
}
```

## responseCode
```json
{"code": "1","msg": "success","data": {"txlogisticId": "10000000001299",
        "orderId": "YL1234567890123",
        "createOrderTime": "2019-08-09 18:15:30"}}
```

## Error codes
- `145002002` — 运单重复,请勿使用相同运单号！
- `145003042` — Order modification failed
- `145003111` — 批次号无效！
- `145003060` — Illegal region
- `145003061` — Illegal city
- `145003062` — Illegal province
- `145003064` — Data not found
- `145003041` — der placement failed
- `145003083` — Incomplete sender information
- `145003112` — 该批次号运单无效！
- `145002001` — Duplicate order, don't place the order repeatedly!
- `145003084` — Incomplete recipient information
- `145003085` — Phone number cannot be empty
- `145003086` — Incomplete address information
- `145003087` — Please check whether the order type, service type, delivery type, item type, shipment type and settlement method are legal
- `145003200` — Please check if the service type is legal with the value of 01 or 02
- `145003088` — Incomplete service time information
- `145003092` — The weight information is not legal
- `145003093` — Incomplete item information
- `145003094` — Incomplete item name
- `145003095` — Incomplete item type
- `145003096` — Illegal item quantity
- `145003099` — Illegal amount
- `145003100` — Illegal waybill number
- `145003101` — Customer order number already exists, cannot place an order!
- `145003103` — Illegal name information
- `145003104` — Company information is too long
- `145003105` — Contact information is too long
- `145003106` — Postcode or email address is illegal
- `145003107` — Price information is illegal
- `145003108` — Comments, descriptions, links are illegal
- `145003109` — Too much address information
- `145003110` — Street information is too long
- `145003111` — The total number of parcels is invalid
- `145003112` — Not yet open COD business
- `145003201` — Picked up status can not be modified
- `145003202` — Cancelled status can not be modified
- `145003203` — Update order failed, please try again later!
- `145003083` — Incomplete information of origin
- `145003084` — Incomplete information of receiving place
- `145003010` — API账号不存在
- `145003114` — 支付方式不匹配,PP_CASH,CC_CASH
- `145003330` — 业务员状态异常
- `145003332` — 请确认运单编号获取来源是否与下单来源一致
- `145003333` — 运单编号已过期，请重新获取
