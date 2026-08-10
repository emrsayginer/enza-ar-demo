/**
 * Uygulama kabuğu: banner, ürün vitrini ve AR ekranı arasındaki akış.
 *
 * Senaryo: kullanıcı ana sayfadaki banner'a dokunur → kamera açılır →
 * ürün gerçek ölçüsüyle odaya yerleşir.
 */
import { ArSahne } from './ar.js'
// Sürüm damgası: her yayında artırılır. Tüm iç kaynaklar bu damgayla
// istendiği için telefonlardaki eski önbellek asla yeni sayfayla karışmaz.
const SURUM = '8'

import { kesimUret } from './cutout.js'
import { duzlemGlbUret, gercekArDestekliMi } from './glb.js'

const $ = (s) => document.querySelector(s)
const $$ = (s) => [...document.querySelectorAll(s)]

const durum = {
  urunler: [],
  sahneler: [],
  aktifKategori: 'Hepsi',
  arListesi: [],
  arIndeks: 0,
  sahneIndeks: 0,
  kameraVar: false,
}

const paraFormat = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fiyatYaz = (f) => (f ? `${paraFormat.format(f)} TL` : '')
const olcuYaz = (u) =>
  `${Math.round(u.genislikMm / 10)} × ${Math.round(u.derinlikMm / 10)} × ${Math.round(u.yukseklikMm / 10)} cm`

let ar

// --------------------------------------------------------------- başlangıç

async function basla() {
  const [urunVeri, odaVeri] = await Promise.all([
    fetch('data/products.json?s=' + SURUM).then((r) => r.json()),
    fetch('data/rooms.json?s=' + SURUM).then((r) => r.json()).catch(() => ({ sahneler: [] })),
  ])

  // Ölçüsü tam VE katalog karesi AR'a uygun ürünler (bkz. tools/qualify.mjs)
  const olculu = urunVeri.urunler.filter((u) => u.genislikMm && u.yukseklikMm && u.derinlikMm)
  durum.urunler = olculu.filter((u) => u.arUygun)
  durum.elenen = olculu.length - durum.urunler.length
  durum.sahneler = odaVeri.sahneler || []

  if (uygulamaIciTarayici()) {
    $('#tarayici-uyari').classList.remove('gizli')
    $('#uyari-kapat').addEventListener('click', () => $('#tarayici-uyari').classList.add('gizli'))
  }

  bannerCiz()
  ciplerCiz()
  izgaraCiz()
  if (durum.elenen) {
    $('#eleme-notu').textContent =
      `${durum.urunler.length} ürün AR'a hazır. ${durum.elenen} üründe katalog karesi uygun değil ` +
      `(kolaj, ödül rozeti ya da salon çekimi) — bunlar 3D model ister.`
  }
  olaylariBagla()

  ar = new ArSahne({ tuval: $('#sahne'), video: $('#kamera'), fonGorsel: $('#oda-fonu') })

  // Sunum sırasında konsoldan ayar denemek için (kamera yüksekliği, görüş açısı vb.)
  window.__demo = { ar, durum }
}

// ------------------------------------------------------------------ vitrin

/** Banner slaytları — her slayt bir kampanya + arkasında AR'a bağlı bir ürün. */
function bannerCiz() {
  const oneCikan = [
    { kategori: 'Koltuk', etiket: 'YENİ SEZON', baslik: 'Koltuk Koleksiyonu', alt: 'Salonuna nasıl yakışacağını şimdi gör' },
    { kategori: 'Yemek Masası', etiket: 'YEMEK ODASI', baslik: 'Masalar', alt: 'Odana sığacak mı? Kamerayla ölç' },
    { kategori: 'Berjer', etiket: 'TAMAMLAYICI', baslik: 'Berjerler', alt: 'Boş köşen için doğru berjeri seç' },
    { kategori: 'Kitaplık', etiket: 'DÜZEN', baslik: 'Kitaplıklar', alt: 'Duvarında ne kadar yer kaplar?' },
  ]

  const kap = $('#banner-slaytlar')
  const noktalar = $('#banner-noktalar')

  oneCikan.forEach((s, i) => {
    const urun = durum.urunler.find((u) => u.kategori === s.kategori)
    if (!urun) return
    const sahne = durum.sahneler[i % Math.max(1, durum.sahneler.length)]

    const el = document.createElement('button')
    el.className = 'slayt'
    el.innerHTML = `
      <img src="${sahne ? sahne.dosya : urun.gorsel}" alt="">
      <div class="ar-etiket">ODANDA DENE</div>
      <div class="slayt-katman">
        <div class="slayt-ust-etiket">${s.etiket}</div>
        <h3>${s.baslik}</h3>
        <p>${s.alt}</p>
        <span class="slayt-btn"><i>⌾</i> Kamerayla Dene</span>
      </div>`
    el.addEventListener('click', () => arAc(durum.urunler.filter((u) => u.kategori === s.kategori), 0))
    kap.appendChild(el)

    const nokta = document.createElement('i')
    if (i === 0) nokta.className = 'aktif'
    noktalar.appendChild(nokta)
  })

  kap.addEventListener('scroll', () => {
    const i = Math.round(kap.scrollLeft / kap.clientWidth)
    $$('#banner-noktalar i').forEach((n, j) => n.classList.toggle('aktif', j === i))
  })
}

function ciplerCiz() {
  const kategoriler = ['Hepsi', ...new Set(durum.urunler.map((u) => u.kategori))]
  const kap = $('#cipler')
  kap.innerHTML = ''
  for (const k of kategoriler) {
    const b = document.createElement('button')
    b.className = 'cip' + (k === durum.aktifKategori ? ' aktif' : '')
    b.textContent = k
    b.addEventListener('click', () => {
      durum.aktifKategori = k
      ciplerCiz()
      izgaraCiz()
    })
    kap.appendChild(b)
  }
}

function filtreliUrunler() {
  return durum.aktifKategori === 'Hepsi'
    ? durum.urunler
    : durum.urunler.filter((u) => u.kategori === durum.aktifKategori)
}

function izgaraCiz() {
  const liste = filtreliUrunler()
  const kap = $('#izgara')
  kap.innerHTML = ''

  liste.forEach((u, i) => {
    const b = document.createElement('button')
    b.className = 'kart'
    b.innerHTML = `
      <div class="kart-gorsel">
        <img src="${u.gorsel}" alt="${u.ad}" loading="lazy">
        <span class="kart-ar">⌾ AR</span>
      </div>
      <div class="kart-ad">${u.ad}</div>
      <div class="kart-tur">${u.tur || u.kategori}</div>
      <div class="kart-olcu">${olcuYaz(u)}</div>
      <div class="kart-fiyat">${fiyatYaz(u.fiyat)}</div>`
    b.addEventListener('click', () => arAc(liste, i))
    kap.appendChild(b)
  })
}

// ---------------------------------------------------------------- AR akışı

async function arAc(liste, indeks) {
  durum.arListesi = liste
  durum.arIndeks = indeks

  $('#vitrin').classList.add('gizli')
  $('#ar').classList.remove('gizli')
  ar.tazeleBoyut()

  // iOS, hareket sensörü iznini YALNIZCA kullanıcı hareketiyle aynı çağrı
  // yığınında ister. Önce kamerayı beklersek dokunma bağlamı kaybolur ve izin
  // sessizce reddedilir — zemin açısı varsayılanda kalır, ürün odaya oturmaz.
  // Bu yüzden izin isteği her şeyden önce, beklemeden başlatılır.
  const yonelimSozu = ar.yonelimiBagla()

  await kamerayiAc()
  arUrunSeridiCiz()
  await arUrunuYukle()

  ar.baslat()
  const gercekAr = await gercekArButonunuTazele()
  if (gercekAr) {
    // Sürükleme modu zemini varsayımla hesaplar; tam oturma gerçek AR'da.
    // Kullanıcıyı doğru butona yönlendir.
    $('#ar-ipucu').textContent = iosMu()
      ? 'Tam oturma için: ⬚ Odaya Sabitle → sağ üstteki küpe dokun'
      : 'Zemine tam oturması için: ⬚ Odaya Sabitle'
  }
  await yonelimSozu
  sabitDugmesiTazele()

  const ipucu = $('#ar-ipucu')
  ipucu.style.opacity = '1'
  clearTimeout(arAc._zaman)
  arAc._zaman = setTimeout(() => (ipucu.style.opacity = '0'), 4500)
}

function arKapat() {
  ar.durdur()
  const akis = $('#kamera').srcObject
  if (akis) akis.getTracks().forEach((t) => t.stop())
  $('#kamera').srcObject = null
  $('#ar').classList.add('gizli')
  $('#vitrin').classList.remove('gizli')
}

/** Arka kamerayı açar; yoksa örnek oda sahnelerine düşer. */
async function kamerayiAc() {
  const video = $('#kamera')
  try {
    const akis = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } },
      audio: false,
    })
    video.srcObject = akis
    await video.play()
    video.classList.add('acik')
    $('#oda-fonu').classList.remove('acik')
    $('#sahne-secici').classList.add('gizli')
    durum.kameraVar = true
  } catch {
    durum.kameraVar = false
    video.classList.remove('acik')
    $('#oda-fonu').classList.add('acik')
    sahneSeciciCiz()
    sahneUygula(durum.sahneIndeks)
    $('#ar-ipucu').textContent = 'Kamera bulunamadı — örnek oda sahnesi kullanılıyor'
  }
}

function sahneSeciciCiz() {
  const kap = $('#sahne-secici')
  if (!durum.sahneler.length) return
  kap.classList.remove('gizli')
  kap.innerHTML = ''
  durum.sahneler.forEach((s, i) => {
    const img = document.createElement('img')
    img.src = s.dosya
    img.className = i === durum.sahneIndeks ? 'aktif' : ''
    img.addEventListener('click', () => sahneUygula(i))
    kap.appendChild(img)
  })
}

function sahneUygula(i) {
  durum.sahneIndeks = i
  const s = durum.sahneler[i]
  if (!s) return
  $('#oda-fonu').src = s.dosya
  $$('#sahne-secici img').forEach((el, j) => el.classList.toggle('aktif', j === i))

  // Katalog sahneleri ~1.2 m yükseklikten, hafif eğimle çekilmiş.
  ar.kamera.yukseklikM = 1.2
  ar.kamera.pitch = 4 * (Math.PI / 180)
  ar.kamera.fovDikey = 46 * (Math.PI / 180)
  ar.sabitlemeyiAyarla(false)
  ar.ilkCercevele()
}

function arUrunSeridiCiz() {
  const kap = $('#ar-urunler')
  kap.innerHTML = ''
  durum.arListesi.forEach((u, i) => {
    const b = document.createElement('button')
    b.className = 'ar-urun' + (i === durum.arIndeks ? ' aktif' : '')
    b.innerHTML = `<img src="${u.gorsel}" alt="${u.ad}">`
    b.addEventListener('click', async () => {
      durum.arIndeks = i
      $$('.ar-urun').forEach((el, j) => el.classList.toggle('aktif', j === i))
      await arUrunuYukle()
    })
    kap.appendChild(b)
  })
}

/**
 * Ürünün hangi yüzeye konacağını belirler.
 * Vazo gibi dekoratif ürünler zemine değil masa/konsol üstüne konur — ARKit ve
 * ARCore de düzlemleri "zemin" ve "masa üstü" diye ayırır.
 */
function yerlestirmeYuzeyi(u) {
  const masaUstu = ['Vazo'].includes(u.kategori) || u.yukseklikMm < 550
  return masaUstu ? 0.75 : 0
}

async function arUrunuYukle() {
  const u = durum.arListesi[durum.arIndeks]
  $('#ar-baslik').innerHTML = `<strong>${u.ad}</strong><span>${olcuYaz(u)}</span>`
  $('#ar-fiyat-tutar').textContent = fiyatYaz(u.fiyat)
  $('#ar-fiyat-olcu').textContent = `${u.tur || u.kategori} · ${olcuYaz(u)}`

  // Uygun kare eleme aşamasında seçildi (tools/qualify.mjs) — burada sadece kes
  const kesim = await kesimUret(u.arGorsel || u.gorsel)
  ar.urunAyarla(u, kesim, yerlestirmeYuzeyi(u))
  cevirDugmesiTazele()
  gercekArButonunuTazele()
}

/**
 * Telefonda hareket sensörünün gerçekten okunup okunmadığını gösterir.
 * "İzin verdim ama ürün yerinde durmuyor" durumunu ayırt etmenin tek yolu bu:
 * eğim değeri telefonu oynattıkça değişiyorsa sensör çalışıyordur.
 */
function sensorDurumuYaz() {
  const el = $('#kal-sensor')
  if (!el) return
  const derece = (r) => Math.round((r * 180) / Math.PI)
  if (!ar.sensorTuru) {
    el.textContent = 'Hareket sensörü yok ya da izin verilmedi — eğim elle ayarlanıyor.'
    el.classList.add('yok')
    return
  }
  el.classList.remove('yok')
  el.textContent = `Sensör çalışıyor (${ar.sensorTuru}) · eğim ${derece(ar.kamera.pitch)}° · yön ${derece(ar.kamera.yaw)}°`
}

/**
 * Konum takipli gerçek AR'a geçer.
 *
 * Ürünün kesimi anında bir GLB'ye çevrilip ARCore/WebXR oturumuna verilir.
 * Fark şu: cihaz sensörüyle yapılan sabitleme yalnızca dönmeyi telafi eder,
 * kullanıcı yürüdüğünde ürün kayar. Burada konum da takip edildiği için ürün
 * odada gerçekten sabit kalır ve etrafında dolaşılabilir.
 */
/**
 * "Odaya Sabitle" butonunu aktif ürüne göre hazırlar.
 *
 * Gerçek zemin algılama: Android'de Scene Viewer (GLB), iPhone'da Quick Look
 * (USDZ). Android'de WebXR bayrağına bakılmaz — Scene Viewer, WebXR kapalı
 * cihazlarda da çalışır. iOS'ta butonun href'i doğrudan USDZ'ye bağlanır;
 * dokunuş linke doğal gittiği için Quick Look AR sekmesi tam yetkili açılır.
 */
async function gercekArButonunuTazele() {
  const u = durum.arListesi[durum.arIndeks]
  const btn = $('#btn-gercek-ar')

  let var_ = false
  if (iosMu()) {
    var_ = !!u?.usdz
    if (var_) btn.setAttribute('href', u.usdz + '?s=' + SURUM)
    else btn.removeAttribute('href')
  } else if (/android/i.test(navigator.userAgent)) {
    var_ = !!u?.glb
  } else {
    var_ = await gercekArDestekliMi()
  }

  btn.classList.toggle('gizli', !var_)
  btn.classList.toggle('one-cikar', var_)
  return var_
}

const iosMu = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

/**
 * WhatsApp/Instagram/Facebook içi tarayıcı tespiti.
 * Apple bu kabuk tarayıcılarda ARKit'i kapalı tutar: Quick Look açılır ama
 * üstteki "AR" sekmesi soluk kalır. Tek çözüm linki Safari'de açmak.
 */
const uygulamaIciTarayici = () =>
  /WhatsApp|Instagram|FBAN|FBAV|FB_IAB|Line\/|Twitter/i.test(navigator.userAgent)

async function gercekAraGec(e) {
  const u = durum.arListesi[durum.arIndeks]
  const btn = $('#btn-gercek-ar')
  const eskiMetin = btn.innerHTML

  // iOS: buton zaten href'i ürünün USDZ'sine bakan gerçek bir rel=ar
  // bağlantısı — varsayılan davranışa DOKUNMA ki Safari dokunuşu doğrudan
  // linke saysın ve Quick Look tam yetkiyle (AR sekmesi aktif) açılsın.
  if (iosMu()) {
    if (!btn.getAttribute('href')) {
      e.preventDefault()
      $('#ar-ipucu').textContent = 'Bu ürün için iOS modeli hazır değil'
      $('#ar-ipucu').style.opacity = '1'
    }
    return
  }

  e.preventDefault()
  btn.innerHTML = '<img alt="" style="display:none"><span>◌</span>Hazırlanıyor'

  try {
    const mv = $('#mv-canli')

    // Önceden üretilmiş GLB dosyası varsa onu kullan. Şart çünkü Android'de
    // AR oturumunu Scene Viewer adlı ayrı uygulama açar ve ona yalnızca
    // gerçek bir https adresi verilebilir; çalışma anındaki blob: adresi
    // orada açılmaz (belirti: yeni ekran gelir ama içi boş kalır).
    if (u.glb) {
      mv.src = new URL(u.glb, location.href).href
    } else {
      const kesim = await kesimUret(u.arGorsel || u.gorsel)
      mv.src = await duzlemGlbUret(kesim.canvas, u.genislikMm / 1000, u.yukseklikMm / 1000)
    }

    await new Promise((coz, red) => {
      mv.addEventListener('load', coz, { once: true })
      mv.addEventListener('error', red, { once: true })
      setTimeout(red, 8000)
    })
    await mv.activateAR()
    $('#ar-ipucu').textContent =
      'Kamerayı zemine veya masaya doğrult — düzlem algılanınca ürün oturur'
    $('#ar-ipucu').style.opacity = '1'
  } catch {
    $('#ar-ipucu').textContent = 'Gerçek AR başlatılamadı — cihaz desteklemiyor olabilir'
    $('#ar-ipucu').style.opacity = '1'
  } finally {
    btn.innerHTML = eskiMetin
  }
}

function sabitDugmesiTazele() {
  $('#btn-sabit').classList.toggle('aktif', ar.dunyayaSabit)
}
function cevirDugmesiTazele() {
  $('#btn-cevir').classList.toggle('aktif', ar.aynala)
}

// ------------------------------------------------------------------ olaylar

function olaylariBagla() {
  $('#ar-kapat').addEventListener('click', arKapat)

  $('#btn-olcu').addEventListener('click', (e) => {
    ar.olcuModu = !ar.olcuModu
    e.currentTarget.classList.toggle('aktif', ar.olcuModu)
  })

  $('#btn-cevir').addEventListener('click', () => {
    ar.aynala = !ar.aynala
    cevirDugmesiTazele()
  })

  $('#btn-sabit').addEventListener('click', async () => {
    if (!ar.dunyayaSabit) {
      const oldu = await ar.yonelimiBagla()
      if (!oldu) {
        $('#ar-ipucu').textContent = 'Bu cihazda yönelim sensörü yok — ürün ekrana sabit'
        $('#ar-ipucu').style.opacity = '1'
      }
    } else {
      ar.sabitlemeyiAyarla(false)
    }
    sabitDugmesiTazele()
  })

  $('#btn-foto').addEventListener('click', async () => {
    const blob = await ar.fotografCek()
    if (!blob) return
    const u = durum.arListesi[durum.arIndeks]
    const dosya = new File([blob], `enza-${u.ad.toLowerCase()}.jpg`, { type: 'image/jpeg' })

    if (navigator.canShare?.({ files: [dosya] })) {
      try {
        await navigator.share({ files: [dosya], title: `${u.ad} · Enza Home` })
        return
      } catch { /* kullanıcı vazgeçti */ }
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = dosya.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  })

  $('#btn-kal').addEventListener('click', (e) => {
    const kapali = $('#kalibrasyon').classList.toggle('gizli')
    e.currentTarget.classList.toggle('aktif', !kapali)
    clearInterval(durum.sensorTimer)
    if (!kapali) durum.sensorTimer = setInterval(sensorDurumuYaz, 200)
  })

  $('#kal-yukseklik').addEventListener('input', (e) => {
    ar.kamera.yukseklikM = Number(e.target.value) / 100
    $('#kal-yukseklik-deger').textContent = ar.kamera.yukseklikM.toFixed(2) + ' m'
  })

  $('#kal-fov').addEventListener('input', (e) => {
    ar.kamera.fovDikey = Number(e.target.value) * (Math.PI / 180)
    $('#kal-fov-deger').textContent = e.target.value + '°'
  })

  $('#btn-gercek-ar').addEventListener('click', gercekAraGec)

  $('#ar-bilgi').addEventListener('click', () => $('#bilgi').classList.remove('gizli'))
  $('#bilgi-kapat').addEventListener('click', () => $('#bilgi').classList.add('gizli'))

  $('#uc-boyut-ac').addEventListener('click', () => {
    $('#vitrin').classList.add('gizli')
    $('#uc-boyut').classList.remove('gizli')
  })
  $('#uc-boyut-kapat').addEventListener('click', () => {
    $('#uc-boyut').classList.add('gizli')
    $('#vitrin').classList.remove('gizli')
  })
}

basla()
