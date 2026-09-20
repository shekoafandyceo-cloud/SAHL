# order/getOrders
_source: https://open.jtjms-eg.com (chunk chunk-6e109868, extracted 2026-09-20)_

**Description:** OrderDescription_2

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
| `customerCode` | String(30) | Y | J0086024138 | Customer code (provided by contacting the shipping outlet) |
| `digest` | String(50) | Y | Clear text password: KO6w29g2 | sign |
| `command` | int(5) | Y |  | Query command 1. Query by customer order number 2. Query by waybill number (check order status with waybill number) 3. Query by time period of order (check order) (query by time period returns unlimited number) 4. Order serial number |
| `serialNumber` | List[] | N |  | command |
| `startDate` | String(30) | N |  | startDate |
| `endDate` | String(30) | N |  | endDate |
| `status` | int(10) | N |  | status |
| `current` | int | N |  | Required when command = 3 |
| `size` | int | N |  | Required when command = 3 |

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
| `lastCenterName` | String | N |  | Collection land |
| `orderNumber` | long | Y |  | System order number |
| `10000000001299` | String | Y |  | Customer order number The order number of the customer's own system |
| `expressType` | String | Y |  | ExpressType |
| `orderStatus` | String | Y |  | Order status: 104 has been cancelled; 103 has been picked up; 102 salesperson has been dispatched; 101 outlets have been dispatched; 100 have not been dispatched |
| `orderType` | String | Y |  | OrderType |
| `serviceType` | String | Y |  | Type of service: <br/>01 door-to-door pickup<br/>02 store delivery  |
| `deliveryType` | String | Y |  | Delivery type:<br/>04 home delivery |
| `payType` | String(30) | N |  | paymentMethod |
| `sortingCode` | String | Y |  | Three-segment code |
| `sumFreight` | String | N |  | Refer to the total freight (numerical type) |
| `sender` | Object | Y |  | Shipment information object |
| `receiver` | Object | Y |  | Receiving information object |
| `sendStartTime` | String | N |  | LC_pick_up_start_time |
| `sendEndTime` | String | N |  | CLC_door_to_door_end_time |
| `goodsType` | String | Y |  | itemtType |
| `length` | int | N |  | Length |
| `width` | int | N |  | Width |
| `height` | int | N |  | Height |
| `volume` | int | N |  | volume |
| `weight` | int | Y |  | Weight |
| `totalQuantity` | int | Y | 默认1 | Total number of packages |
| `itemsValue` | String | N |  | Amount of payment (numeric) |
| `priceCurrency` | String | N |  | collectionPayment |
| `offerFee` | String | N |  | offerFee |
| `remark` | String | N |  | Remark |
| `items` | List | N |  | Product information list |
| `createOrderTime` | String | Y |  | Order creation time yyyy-MM-dd HH:mm:ss |
| `fodMoney` | String(14) | N |  | Freight on delivery amount (numeric type) |
| `pickInfo` | String(500) | N | Iphone 15 pro max 512GB *1; Air pods *1; Bag *1 | pickInfo |

### sender type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `zhangsan` | String(50) | Y |  | Sender name |
| `company` | String(100) | N |  | Shipping company |
| `postCode` | String(32) | N |  | Shipping zip code |
| `mailBox` | String(150) | N |  | Sending mailbox |
| `mobile` | String(11) | Y |  | SendingMobilePhone |
| `phone` | String(11) | Y |  | SendingPhoneNumber |
| `countryCode` | String(20) | Y |  | ThreeCharacterSending |
| `prov` | String(60) | Y |  | Sending province |
| `city` | String(60) | Y |  | Sending city |
| `area` | String(60) | Y |  | Shipping area |
| `street` | String(200) | Y |  | Sending street |
| `building` | String(20) | N |  | building No |
| `floor` | String(20) | N |  | floor |
| `flats` | String(20) | N |  | room number |
| `longitude` | Number | N |  | longitude |
| `latitude` | Number | N |  | latitude |

### Receiver type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `zhangsan` | String(50) | Y |  | The recipient's name |
| `company` | String(100) | N |  | receiver |
| `postCode` | String(32) | N |  | Receiving postal code |
| `mailBox` | String(150) | N |  | Receiving mailbox |
| `mobile` | String(11) | Y |  | ReceivingMobilephone |
| `phone` | String(11) | Y |  | ReceivingPhoneNumber |
| `countryCode` | String(20) | Y |  | ThreeCharacterRecipient |
| `prov` | String(60) | Y |  | Receiving province |
| `city` | String(60) | Y |  | Receiving city |
| `area` | String(60) | Y |  | Receiving area |
| `street` | String(200) | Y |  | Receiving street |
| `building` | String(20) | N |  | building No |
| `floor` | String(20) | N |  | floor |
| `flats` | String(20) | N |  | room number |
| `longitude` |  | N |  | longitude |
| `latitude` |  | N |  | latitude |

### Item type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `itemType` | String(30) | N |  | Item type: <p>ITN1 Clothes</p>  <p>ITN2 Document</p>  <p>ITN3 Food</p>  <p>ITN5  Digital product</p>  <p>ITN6  Daily necessities</p>  <p>ITN7 Fragile Items</p>  <p>ITN8 Tools</p><p>ITN9 Stationery</p><p>ITN10 Furniture</p><p>ITN11 Certificate</p><p>ITN12 Machine Parts</p><p>ITN13 handicraft</p><p>ITN14 Production Materials</p><p>ITN15 Books</p><p>ITN16 Others</p> |
| `itemName` | String(30) | N |  | Item Name |
| `chineseName` | String(60) | N |  | Chinese name of the item |
| `englishName` | String(60) | N |  | English name of the item |
| `number` | int(4) | N |  | cases |
| `itemValue` | String(20) | N |  | Declared value (numerical type) |
| `priceCurrency` | String(20) | N |  | priceCurrency |
| `desc` | String(100) | N |  | item description |
| `itemUrl` | String(100) | N |  | Product URL |

## requestCode
```json
Header：
    apiAccount=292508153084379141
    digest=4edK6B29aklprKSR8yv/nA==
    timestamp=1646982575055

Body：
    bizContent= {
      'command': 1, 
      'serialNumber': ['EGYUAT81235870018'], 
      'customerCode': 'J0086024138', 
      'digest': 'wapT8IYOjNeViOL5eZupEg=='
    }
```

## responseCode
```json
{
    "code": "1",
    "msg": "success",
    "data": [
      {"customerId":"J0086024138",
      "txlogisticId":"EGYUAT81235870018",
      "billCode":"UEG000000162960",
      "expressType":"EZ",
      "orderType":"2",
      "serviceType":"02",
      "deliveryType":"04",
      "sender":{
        "name":"test_senderkjcbdskfksfks_sfjd4kj",
        "company":"sendercompanyfhskafoiljsd fjsjfdsjldfsafdsf sdlcjldsjflsak7834793274ncllsdjfljfldsnnnnnnnnnnnnnnnnnn",
        "postCode":"16880",
        "mailBox":"ant_li12345678901234567890@qq.com",
        "mobile":"1441234567843543543554311143",
        "phone":"1441234567843543543554311143",
        "prov":"الشرقية","city":"الزقازيق","area":"حي الزهور"
        },
        "receiver":{
          "name":"test_receiverkjcbdskfk4kjcbdskfk",
          "company":"guangdongshengshenzhenshizhuantayigeyidianzishiyeyouxianggongsi",
          "postCode":"54830",
          "mailBox":"ant_li123@qq.com",
          "mobile":"1441234567843543543554311143",
          "phone":"23423423423445",
          "prov":"الجيزة",
          "city":"مدينة الشيخ زايد",
          "area":"أركان"
          },
          "createOrderTime":"2022-03-11T09:09:19",
          "updateOrderTime":"2022-03-11T09:09:20",
          "sendEndTime":"2022-03-13T15:09:18",
          "payType":"PP_PM",
          "goodsType":"ITN1","length":30,
          "width":10,
          "height":60,
          "volume":18000,
          "weight":5.02,
          "totalQuantity":1,
          "offerFee":23,
          "remark":"test",
          "items":[{"chineseName":"test_order","englishName":"test","number":1,"itemValue":"2000","priceCurrency":"DHS","desc":"test_order"},{"chineseName":"test_order","englishName":"test","number":1,"itemValue":"2000","priceCurrency":"DHS","desc":"test_order"}],"orderNumber":370121403627737120,"sortingCode":"    ","orderStatus":100}]
}
```

## Error codes
- `145003031` — Business parameter signature verification failed
- `145003097` — Illegal time range
- `145003102` — Illegal page number
- `145003098` — Data limit exceeded
