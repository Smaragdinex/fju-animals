// 十種校園動物的介紹與大概出沒地點。
// spot 是校園座標（公尺，原點在校園中心，x 向東、z 向南），place 是附近的地標。
// perch：ground 站在地上、branch 停在樹枝上、trunk 貼在樹幹上、rock 趴在池中石頭上。
// view：鏡頭從哪個方位角（度，0 = 從南邊看）看牠。
export const ANIMALS = [
  {
    id: 'heron', spot: [14, 30], place: '第二圓環草地', perch: 'ground', view: 200,
    name: '黑冠麻鷺', nick: '地瓜', sci: 'Gorsachius melanolophus',
    where: '草地', habitat: 'lawn',
    intro: '圓滾滾的身體、慢吞吞的步伐，讓牠有了「地瓜」這個暱稱。常在草地上一步一步地走，盯著地面找蚯蚓，找到就一口叼起來。',
    facts: [
      '受到驚嚇時不會馬上飛走，而是伸長脖子、一動也不動，假裝自己是一根樹枝。',
      '雨後草地上蚯蚓多，最容易看到牠出來覓食。',
      '看到牠時請保持距離，不要追趕或餵食。',
    ],
  },
  {
    id: 'squirrel', spot: [-14, 128], place: '維也納森林', perch: 'branch', view: 150,
    name: '赤腹松鼠', sci: 'Callosciurus erythraeus',
    where: '大樹上', habitat: 'tree',
    intro: '肚子是紅褐色的松鼠，在樹枝之間跳來跳去，尾巴又長又蓬。吃果實、種子和嫩芽，有時也會啃樹皮。',
    facts: [
      '緊張時會一邊甩尾巴，一邊發出「嘎、嘎」的叫聲警告同伴。',
      '會把食物藏起來，有些忘了吃的種子就長成新的樹。',
    ],
  },
  {
    id: 'barbet', spot: [96, 52], place: '荷花池旁的樹林', perch: 'branch', view: 210,
    name: '五色鳥', sci: 'Psilopogon nuchalis',
    where: '樹冠', habitat: 'tree',
    intro: '台灣特有種。身上有綠、藍、黃、紅、黑五種顏色，因為臉上的花紋，也被叫做「花和尚」。',
    facts: [
      '叫聲「咯、咯、咯」很像敲木魚，常常只聞其聲不見其鳥。',
      '會用粗壯的嘴在枯木上啄洞當作巢。',
      '綠色的身體躲在樹葉裡很難發現，找叫聲的方向比較容易。',
    ],
  },
  {
    id: 'bulbul', spot: [-2, -7], place: '第二圓環北側的樹林', perch: 'branch', view: 170,
    name: '白頭翁', sci: 'Pycnonotus sinensis',
    where: '樹叢、電線上', habitat: 'tree',
    intro: '校園裡最常見的鳥之一，成鳥的後腦勺有一塊白色羽毛，看起來像白頭髮。吃果實也吃昆蟲。',
    facts: [
      '剛離巢的幼鳥頭還是灰色的，長大才會變白。',
      '常常好幾隻在樹上吱吱喳喳地叫，聲音很熱鬧。',
    ],
  },
  {
    id: 'whiteeye', spot: [46, 236], place: '小巴黎', perch: 'branch', view: 160,
    name: '綠繡眼', sci: 'Zosterops simplex',
    where: '開花的樹', habitat: 'tree',
    intro: '小小的黃綠色身體，眼睛周圍有一圈白色的眼圈，就像繡上去的一樣。喜歡成群在開花的樹上吸花蜜。',
    facts: [
      '一群一起移動，邊飛邊發出細細的「唧、唧」聲。',
      '吸花蜜的時候也會幫植物傳粉。',
    ],
  },
  {
    id: 'dove', spot: [92, 205], place: '第一圓環草地', perch: 'ground', view: 120,
    name: '珠頸斑鳩', sci: 'Spilopelia chinensis',
    where: '草地、步道邊', habitat: 'lawn',
    intro: '脖子後面有一圈黑底白點的羽毛，像戴著一串珍珠項鍊。常在地上邊走邊點頭，撿草籽吃。',
    facts: [
      '叫聲是低低的「咕咕－咕」。',
      '走路時頭會一前一後地擺動，這樣看東西比較清楚。',
    ],
  },
  {
    id: 'treepie', spot: [-112, 96], place: '百鍊廳旁的樹林', perch: 'branch', view: 200,
    name: '樹鵲', sci: 'Dendrocitta formosae',
    where: '高樹', habitat: 'tree',
    intro: '烏鴉的親戚，有一條長長的尾巴，飛起來翅膀上的白斑很明顯。很聰明，什麼都吃。',
    facts: [
      '叫聲響亮，常被形容成「葛格、葛格」。',
      '雜食性，果實、昆蟲、蜥蜴，甚至其他鳥的蛋都會吃。',
    ],
  },
  {
    id: 'nightheron', spot: [118, 18.5], place: '荷花池', perch: 'ground', view: 160,
    name: '夜鷺', sci: 'Nycticorax nycticorax',
    where: '池塘邊', habitat: 'pond',
    intro: '常縮著脖子站在水邊，看起來像在打瞌睡，其實在等魚游過來。傍晚和晚上最活躍。',
    facts: [
      '成鳥有一雙紅色的眼睛，頭後面還有細長的白色飾羽。',
      '幼鳥全身是褐色帶白點，和爸媽長得很不一樣，又叫「星鳽」。',
    ],
  },
  {
    id: 'lizard', spot: [83, -35], place: '文開樓前的樹林', perch: 'trunk', view: 190,
    name: '斯文豪氏攀蜥', sci: 'Diploderma swinhonis',
    where: '樹幹上', habitat: 'trunk',
    intro: '台灣特有種的蜥蜴，常貼在樹幹上曬太陽，一有動靜就繞到樹幹另一邊躲起來。',
    facts: [
      '公的會上下點頭、做「伏地挺身」，向其他公蜥蜴宣示地盤。',
      '體色會隨溫度和心情變深或變淺。',
    ],
  },
  {
    id: 'turtle', spot: [134, 22], place: '荷花池', perch: 'rock', view: 200,
    name: '池塘的烏龜', sci: 'Testudines',
    where: '池塘', habitat: 'pond',
    intro: '天氣好的時候，烏龜會爬上石頭或岸邊曬太陽，一受驚嚇就「噗通」跳回水裡。',
    facts: [
      '曬太陽可以幫助牠們調節體溫，也能讓殼保持健康。',
      '校園池塘常見的有本土的斑龜，也有被棄養的外來種紅耳龜。',
      '請不要把寵物龜放進池塘，外來種會和本土烏龜搶食物和地盤。',
    ],
  },
]
