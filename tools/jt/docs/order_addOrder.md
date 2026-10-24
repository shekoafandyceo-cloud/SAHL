# order/addOrder
_source: https://open.jtjms-eg.com (chunk chunk-1a364cbd, extracted 2026-09-20)_

**Description:** OrderDescription_1

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
| `network` | String(30) | N |  | Cooperation outlets |
| `10000000001299` | String(50) | Y |  | Customer order number (pass the order number of the customer’s own system) |
| `expressType` | String(30) | Y |  | ExpressType |
| `deliveryType` | String(30) | Y |  | Delivery type:<br/>04 home delivery |
| `payType` | String(30) | N |  | paymentMethod |
| `sender` | Object | Y |  | Shipment information object |
| `receiver` | Object | Y |  | Receiving information object |
| `sendStartTime` | String(30) | N |  | LC_pick_up_start_time |
| `sendEndTime` | String(30) | N |  | CLC_door_to_door_end_time |
| `goodsType` | String(30) | Y |  | itemtType |
| `weight` | String(12) | Y | 0.02 | Weight |
| `totalQuantity` | int(4) | Y |  | Total number of tickets for the package (must be 1) |
| `fodMoney` | String(14) | N |  | Freight on delivery amount (numeric type) |
| `itemsValue` | String(12) | N |  | Amount of payment (numeric) |
| `priceCurrency` | String(32) | N |  | collectionPayment |
| `offerFee` | String(12) | N |  | offerFee |
| `remark` | String(200) | N |  | Remark |
| `items` | Object | N |  | Product information list |
| `customsInfo` | Object | N |  | Customer Information |
| `operateType` | int(4) | Y |  | operateType |
| `expectDeliveryStartTime` | String(20) | N |  | expectDeliveryStartTime |
| `expectDeliveryEndTime` | String(20) | N |  | expectDeliveryEndTime |
| `exdrDescription` | String(500) | N |  | exdrDescription |
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
| `longitude` | Number | N |  | longitude |
| `latitude` | Number | N |  | latitude |

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

### customsInfo type description

| name | type | req | example | describe |
|---|---|---|---|---|
| `count` | Number(5) | N |  | The quantity of goods needs to be filled in for cross-border customs declaration |
| `unit` | String(30) | N |  | Cargo unit, such as: unit, Taiwan, this, cross-border cargo declaration needs to be filled in |
| `sourceArea` | String(5) | N |  | Country of origin, cross-border customs declaration needs to be filled in |
| `productRecordNo` | String(18) | N |  | National inspection record number of goods and products, cross-border customs declaration needs to be filled in |
| `goodPrepardNo` | String(100) | N |  | Commodity customs record number |
| `taxNo` | String(100) | N |  | Commodity postal tax number is required for cross-border customs declaration |
| `hsCode` | String(100) | N |  | Customs code is required for cross-border customs declaration |
| `goodsCode` | String(60) | N |  | Commodity No. Cross-border customs declaration needs to be filled in |
| `brand` | String(60) | N |  | Cargo brand cross-border customs declaration needs to be filled in |
| `specifications` | String(60) | N |  | Cargo specifications and models, cross-border cargo declarations need to be filled in |
| `manufacturer` | String(100) | N |  | Manufacturers need to fill in cross-border customs declaration |
| `cargoDeclaredValue` | Double (16,5) | N |  | The declared value of the consignment is required for cross-border customs declaration |
| `declaredValueDeclaredCurrency` | String(5) | N |  | Consignment declared value currency, cross-border customs declaration needs to be filled in |
| `customerFreight` | String(100) | N |  | The freight paid by the customer is required for cross-border customs declaration |

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
| `10000000001299` | String | Y |  | Return customer order number |
| `createOrderTime` | String | Y |  | Order creation time yyyy-MM-dd HH:mm:ss |
| `sortingCode` | String | Y |  | Three-segment code (get the three-segment code first to return to the three-segment code, if there is no three-segment code, return to the big pen) |
| `sumFreight` | String | N |  | Refer to the total freight (numerical type) |

## requestCode
```json
Header：
    apiAccount=292508153084379141
    digest=we0A7iThtk0558LsyDn3DQ==
    timestamp=1647413624337

Body：
    bizContent={
      'customerCode': 'J0086024138', 
      'digest': 'wapT8IYOjNeViOL5eZupEg==', 
      'deliveryType': '04', 
      'payType': 'PP_PM', 
      'expressType': 'EZ', 
      'network': '', 
      'sendStartTime': '2022-03-17 14:53:44', 
      'weight': 5.02, 
      'remark': 'test', 
      'invoceNumber': '231321354564654', 
      'packingNumber': '1313213254564564df', 
      'batchNumber': '', 
      'txlogisticId': 'EGYUAT72504945102', 
      'billCode': '', 
      'operateType': 1, 
      'goodsType': 'ITN1', 
      'totalQuantity': '1', 
      'receiver': {
        'area': 'الصبحه', 
        'address': 
        'sdfsacdscdscdsa', 
        'addressBak': 'receivercdsfsafdsaf lkhdlksjlkfjkndskjfnhskjlkafdslkjdshflksjal',
        'town': '', 
        'city': 'القوصية', 
        'mobile': '1441234567843543543554311143',
        'mailBox': 'ant_li123@qq.com', 
        'phone': '23423423423445', 
        'countryCode': 'EGY', 
        'name': 'test_receiverkjcbdskfk4kjcbdskfksdsfdsf', 
        'alternateReceiverPhoneNo': '12-31321322', 
        'company': 'guangdongshengshenzhenshizhuantayigeyidianzishiyeyouxianggongsi', 
        'postCode': '54830', 
        'prov': 'أسيوط', 
        'areaCode': '2342343', 
        'building': '13', 
        'floor': '25', 
        'flats': '47',
        }, 
        'sender': {
          'area': 'حي الزهور', 
          'street': 'street122', 
          'city': 'الزقازيق', 
          'mobile': '1441234567843543543554311143', 
          'mailBox': 'ant_li12345678901234567890@qq.com', 
          'phone': '1441234567843543543554311143', 
          'countryCode': 'MEX', 
          'name': 'test_senderkjcbdskfksfks_sfjd4kjcbdskfksdsfdsf', 
          'company': 'sendercompanyfhskafoiljsd fjsjfdsjldfsafdsf sdlcjldsjflsak7834793274ncllsdjfljfldsnnnnnnnnnnnnnnnnnnnnnnnnnnnkjchlksdfldscnsdlkfsklflsajlkfjlkdsjlajflkdcn,smdfnaskldlsdlfsalkanlflsajl fkjsdlcngjgjajdfhfkdscnbskfkjsahkcmnsutwuertuyewrabhdbsfskjfkbcsbfbkjsghkflald', 
          'postCode': '16880', 
          'prov': 'الشرقية', 
          'areaCode': '324234', 
          'building': '13', 
          'floor': '25', 
          'flats': '47'
          }, 
          'width': 10, 
          'offerFee': 23, 
          'items': [{
            'englishName': 'test', 
            'number': 1, 
            'itemType': 'ITN1', 
            'itemName': 'file type', 
            'priceCurrency': 'DHS', 
            'itemValue': '2000', 
            'chineseName': 'test_order', 
            'itemUrl': 'http://www.baidu.com', 
            'desc': 'test_order'}, 
            {
              'englishName': 'test', 
              'number': 1, 
              'itemType': 'ITN1', 
              'itemName': 'file type', 
              'priceCurrency': 'DHS', 
              'itemValue': '2000', 
              'chineseName': 'test_order', 
              'itemUrl': 'http://www.baidu.com', 
              'desc': 'test_order'
            }], 
          'sendEndTime': '2022-03-18 14:53:44', 
          'height': 60}
```

## responseCode
```json
{"code": "1","msg": "success","data": {"txlogisticId":"EGYUAT72504945102","billCode":"UEG000000191681","sortingCode":"20,J01-01,000","createOrderTime":"2022-03-16 08:53:45","lastCenterName":"10thRamadanCityHub"}}
```

## Error codes
- `145003031` — Business parameter signature verification failed
- `145003042` — Order modification failed
- `145003060` — Illegal region
- `145003061` — Illegal city
- `145003062` — Illegal province
- `145003064` — Data not found
- `145003041` — der placement failed
- `145003083` — Incomplete sender information
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
- `145003113` — The payment method does not match,PP_CASH,CC_CASH,PP_MM
- `145003201` — Picked up status can not be modified
- `145003202` — Cancelled status can not be modified
- `145003203` — Update order failed, please try again later!
- `145003083` — Incomplete information of origin
- `145003084` — Incomplete information of receiving place
