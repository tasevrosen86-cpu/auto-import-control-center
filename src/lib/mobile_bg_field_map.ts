export type FieldType = 'text' | 'number' | 'select' | 'multiselect' | 'checkbox' | 'textarea' | 'image' | 'date';
export type FieldSource = 'catalog' | 'encar' | 'autotrader' | 'broker' | 'agent' | 'manual';
export type FieldSection = 'basic' | 'price' | 'extras' | 'description' | 'images' | 'publishing' | 'source_control';

export interface MobileBgFieldDef {
  key: string;
  mobile_bg_label: string;
  our_db_key: string;
  field_type: FieldType;
  required: boolean;
  source: FieldSource;
  agent_can_fill: boolean;
  needs_human_confirmation: boolean;
  section: FieldSection;
  options?: string[];
  group?: string;
  placeholder?: string;
}

export const MOBILE_BG_FIELD_MAP: MobileBgFieldDef[] = [
  // === 1. Основни данни за автомобила ===
  { key: 'category', mobile_bg_label: 'Категория', our_db_key: 'category', field_type: 'select', required: true, source: 'catalog', agent_can_fill: true, needs_human_confirmation: false, section: 'basic', options: ['Автомобили и джипове'] },
  { key: 'make', mobile_bg_label: 'Марка', our_db_key: 'make', field_type: 'select', required: true, source: 'catalog', agent_can_fill: true, needs_human_confirmation: false, section: 'basic' },
  { key: 'model', mobile_bg_label: 'Модел', our_db_key: 'model', field_type: 'select', required: true, source: 'catalog', agent_can_fill: true, needs_human_confirmation: false, section: 'basic' },
  { key: 'modification', mobile_bg_label: 'Модификация', our_db_key: 'modification', field_type: 'text', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', placeholder: 'напр. 2.0 TDI 190hp Premium' },
  { key: 'year', mobile_bg_label: 'Година на производство', our_db_key: 'model_year', field_type: 'number', required: true, source: 'catalog', agent_can_fill: true, needs_human_confirmation: false, section: 'basic' },
  { key: 'month', mobile_bg_label: 'Месец на производство', our_db_key: 'production_month', field_type: 'select', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', options: ['Януари','Февруари','Март','Април','Май','Юни','Юли','Август','Септември','Октомври','Ноември','Декември'] },
  { key: 'mileage', mobile_bg_label: 'Пробег', our_db_key: 'mileage_km', field_type: 'number', required: true, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', placeholder: 'в км' },
  { key: 'fuel', mobile_bg_label: 'Гориво', our_db_key: 'fuel', field_type: 'select', required: true, source: 'catalog', agent_can_fill: true, needs_human_confirmation: false, section: 'basic', options: ['Бензин','Дизел','Хибрид','Електрически','Газ (LPG)'] },
  { key: 'gearbox', mobile_bg_label: 'Скоростна кутия', our_db_key: 'gearbox', field_type: 'select', required: true, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', options: ['Ръчна','Автоматична','Полуавтоматична','Вариатор','DCT','Tiptronic'] },
  { key: 'power', mobile_bg_label: 'Мощност', our_db_key: 'power_hp', field_type: 'number', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', placeholder: 'в к.с.' },
  { key: 'displacement', mobile_bg_label: 'Кубатура', our_db_key: 'displacement_cc', field_type: 'number', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', placeholder: 'в куб. см.' },
  { key: 'euro_standard', mobile_bg_label: 'Екокатегория', our_db_key: 'euro_standard', field_type: 'select', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', options: ['Euro 1','Euro 2','Euro 3','Euro 4','Euro 5','Euro 6','Euro 6d'] },
  { key: 'color', mobile_bg_label: 'Цвят', our_db_key: 'color', field_type: 'select', required: true, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', options: ['Бял','Черен','Сив','Сребърен','Златен','Червен','Син','Зелен','Кафяв','Жълт','Оранжев','Бежов','Лилав','Друг'] },
  { key: 'doors', mobile_bg_label: 'Брой врати', our_db_key: 'doors', field_type: 'select', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', options: ['2/3','4/5','5+'] },
  { key: 'seats', mobile_bg_label: 'Брой места', our_db_key: 'seats', field_type: 'number', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic' },
  { key: 'condition', mobile_bg_label: 'Състояние', our_db_key: 'condition', field_type: 'select', required: true, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'basic', options: ['Нов','Използван','За части'] },
  { key: 'drivetrain', mobile_bg_label: 'Задвижване', our_db_key: 'drivetrain', field_type: 'select', required: true, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', options: ['Предно','Задно','4x4'] },
  { key: 'vin', mobile_bg_label: 'VIN', our_db_key: 'vin', field_type: 'text', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', placeholder: '17 символа' },
  { key: 'generation', mobile_bg_label: 'Генерация', our_db_key: 'generation', field_type: 'text', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: true, section: 'basic' },
  { key: 'facelift', mobile_bg_label: 'Фейслифт', our_db_key: 'facelift', field_type: 'select', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: true, section: 'basic', options: ['Не','Да'] },

  // === 2. Цена и условия ===
  { key: 'price', mobile_bg_label: 'Цена', our_db_key: 'price_eur', field_type: 'number', required: true, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'price', placeholder: 'в EUR' },
  { key: 'currency', mobile_bg_label: 'Валута', our_db_key: 'currency', field_type: 'select', required: true, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'price', options: ['EUR','BGN','USD'] },
  { key: 'vat_included', mobile_bg_label: 'Цената с ДДС ли е', our_db_key: 'vat_included', field_type: 'select', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'price', options: ['Да','Не'] },
  { key: 'leasing', mobile_bg_label: 'Възможност за лизинг', our_db_key: 'leasing_available', field_type: 'select', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'price', options: ['Не','Да'] },
  { key: 'barter', mobile_bg_label: 'Бартер', our_db_key: 'barter', field_type: 'select', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'price', options: ['Не','Да'] },
  { key: 'extra_conditions', mobile_bg_label: 'Допълнителни условия', our_db_key: 'extra_conditions', field_type: 'text', required: false, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'price' },
  { key: 'our_calculated_price', mobile_bg_label: 'Наша калкулирана цена', our_db_key: 'our_price_eur', field_type: 'number', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: false, section: 'price', placeholder: 'в EUR' },
  { key: 'min_acceptable_price', mobile_bg_label: 'Минимална допустима цена', our_db_key: 'min_price_eur', field_type: 'number', required: false, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'price', placeholder: 'в EUR' },
  { key: 'calc_source', mobile_bg_label: 'Източник на калкулацията', our_db_key: 'calc_source', field_type: 'select', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: false, section: 'price', options: ['Encar','AutoTrader','Каталог','Ръчна'] },

  // === 3. Екстри (grouped) ===
  // Безопасност
  { key: 'abs', mobile_bg_label: 'ABS', our_db_key: 'extra_abs', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'esp', mobile_bg_label: 'ESP', our_db_key: 'extra_esp', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'airbag_driver', mobile_bg_label: 'Въздушна възглавница водач', our_db_key: 'extra_airbag_driver', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'airbag_passenger', mobile_bg_label: 'Въздушна възглавница пътажик', our_db_key: 'extra_airbag_passenger', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'airbag_side', mobile_bg_label: 'Бокови въздушни възглавници', our_db_key: 'extra_airbag_side', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'airbag_curtain', mobile_bg_label: 'Въздушни завеси', our_db_key: 'extra_airbag_curtain', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'isofix', mobile_bg_label: 'ISOFIX', our_db_key: 'extra_isofix', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'lane_assist', mobile_bg_label: 'Асистент за лента', our_db_key: 'extra_lane_assist', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'adaptive_cruise', mobile_bg_label: 'Адаптивен темпомат', our_db_key: 'extra_adaptive_cruise', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'blind_spot', mobile_bg_label: 'Сензор за мъртва зона', our_db_key: 'extra_blind_spot', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  { key: 'auto_brake', mobile_bg_label: 'Автоматично спиране', our_db_key: 'extra_auto_brake', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Безопасност' },
  // Комфорт
  { key: 'ac', mobile_bg_label: 'Климатик', our_db_key: 'extra_ac', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'ac_auto', mobile_bg_label: 'Автоматичен климатик', our_db_key: 'extra_ac_auto', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'heated_seats_front', mobile_bg_label: 'Подгряване на предни седалки', our_db_key: 'extra_heated_seats_front', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'heated_seats_rear', mobile_bg_label: 'Подгряване на задни седалки', our_db_key: 'extra_heated_seats_rear', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'ventilated_seats', mobile_bg_label: 'Вентилирани седалки', our_db_key: 'extra_ventilated_seats', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'heated_steering', mobile_bg_label: 'Подгряване на волан', our_db_key: 'extra_heated_steering', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'electric_seats', mobile_bg_label: 'Електрически седалки', our_db_key: 'extra_electric_seats', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'memory_seats', mobile_bg_label: 'Памет на седалки', our_db_key: 'extra_memory_seats', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'sunroof', mobile_bg_label: 'Панорамен покрив', our_db_key: 'extra_sunroof', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'parking_sensors_front', mobile_bg_label: 'Парктроник преден', our_db_key: 'extra_parking_front', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'parking_sensors_rear', mobile_bg_label: 'Парктроник заден', our_db_key: 'extra_parking_rear', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: 'rear_camera', mobile_bg_label: 'Камера за назад', our_db_key: 'extra_rear_camera', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  { key: '360_camera', mobile_bg_label: '360° камера', our_db_key: 'extra_360_camera', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Комфорт' },
  // Мултимедия
  { key: 'navigation', mobile_bg_label: 'Навигация', our_db_key: 'extra_navigation', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Мултимедия' },
  { key: 'apple_carplay', mobile_bg_label: 'Apple CarPlay', our_db_key: 'extra_carplay', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Мултимедия' },
  { key: 'android_auto', mobile_bg_label: 'Android Auto', our_db_key: 'extra_android_auto', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Мултимедия' },
  { key: 'premium_audio', mobile_bg_label: 'Премиум аудио система', our_db_key: 'extra_premium_audio', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Мултимедия' },
  { key: 'bluetooth', mobile_bg_label: 'Bluetooth', our_db_key: 'extra_bluetooth', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Мултимедия' },
  { key: 'usb', mobile_bg_label: 'USB', our_db_key: 'extra_usb', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Мултимедия' },
  { key: 'wireless_charging', mobile_bg_label: 'Безжично зареждане', our_db_key: 'extra_wireless_charging', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Мултимедия' },
  // Защита
  { key: 'alarm', mobile_bg_label: 'Аларма', our_db_key: 'extra_alarm', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Защита' },
  { key: 'immobilizer', mobile_bg_label: 'Иммобилайзер', our_db_key: 'extra_immobilizer', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Защита' },
  { key: 'central_locking', mobile_bg_label: 'Централно заключване', our_db_key: 'extra_central_locking', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Защита' },
  { key: 'keyless_go', mobile_bg_label: 'Keyless Go', our_db_key: 'extra_keyless_go', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Защита' },
  // Други
  { key: 'led_headlights', mobile_bg_label: 'LED фарове', our_db_key: 'extra_led_headlights', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'xenon_headlights', mobile_bg_label: 'Ксенонови фарове', our_db_key: 'extra_xenon', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'adaptive_lights', mobile_bg_label: 'Адаптивни фарове', our_db_key: 'extra_adaptive_lights', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'rain_sensor', mobile_bg_label: 'Сензор за дъжд', our_db_key: 'extra_rain_sensor', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'light_sensor', mobile_bg_label: 'Сензор за светлина', our_db_key: 'extra_light_sensor', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'tinted_windows', mobile_bg_label: 'Тонирани стъкла', our_db_key: 'extra_tinted', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'roof_rack', mobile_bg_label: 'Кошница на покрива', our_db_key: 'extra_roof_rack', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'tow_hitch', mobile_bg_label: 'Уред за теглене', our_db_key: 'extra_tow_hitch', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'winter_tires', mobile_bg_label: 'Зимни гуми', our_db_key: 'extra_winter_tires', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  { key: 'summer_tires', mobile_bg_label: 'Летни гуми', our_db_key: 'extra_summer_tires', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Други' },
  // Специализирани
  { key: 'sport_mode', mobile_bg_label: 'Спортен режим', our_db_key: 'extra_sport_mode', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Специализирани' },
  { key: 'air_suspension', mobile_bg_label: 'Пневматично окачване', our_db_key: 'extra_air_suspension', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Специализирани' },
  { key: 'adaptive_suspension', mobile_bg_label: 'Адаптивно окачване', our_db_key: 'extra_adaptive_suspension', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Специализирани' },
  { key: 'differential_lock', mobile_bg_label: 'Диференциална блокировка', our_db_key: 'extra_diff_lock', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Специализирани' },
  { key: 'offroad_package', mobile_bg_label: 'Офроуд пакет', our_db_key: 'extra_offroad', field_type: 'checkbox', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: true, section: 'extras', group: 'Специализирани' },

  // === 4. Описание ===
  { key: 'title', mobile_bg_label: 'Заглавие на обявата', our_db_key: 'title', field_type: 'text', required: true, source: 'agent', agent_can_fill: true, needs_human_confirmation: true, section: 'description' },
  { key: 'description', mobile_bg_label: 'Описание', our_db_key: 'description', field_type: 'textarea', required: true, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'description' },
  { key: 'auto_description', mobile_bg_label: 'Автоматично генерирано описание', our_db_key: 'auto_description', field_type: 'textarea', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: true, section: 'description' },
  { key: 'broker_description', mobile_bg_label: 'Ръчно описание от брокера', our_db_key: 'broker_description', field_type: 'textarea', required: false, source: 'broker', agent_can_fill: false, needs_human_confirmation: false, section: 'description' },
  { key: 'final_description', mobile_bg_label: 'Финално описание за Mobile.bg', our_db_key: 'final_description', field_type: 'textarea', required: true, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'description' },
  { key: 'company_template', mobile_bg_label: 'Шаблон на фирмата', our_db_key: 'company_template', field_type: 'select', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'description', options: ['Стандартен','Премиум','Без шаблон'] },
  { key: 'description_language', mobile_bg_label: 'Език на описанието', our_db_key: 'description_language', field_type: 'select', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'description', options: ['Български','Английски'] },

  // === 5. Снимки ===
  { key: 'source_images', mobile_bg_label: 'Снимки от източника', our_db_key: 'source_images', field_type: 'image', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: false, section: 'images' },
  { key: 'selected_images', mobile_bg_label: 'Избрани за публикуване снимки', our_db_key: 'selected_images', field_type: 'image', required: false, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'images' },
  { key: 'main_image', mobile_bg_label: 'Основна снимка', our_db_key: 'main_image', field_type: 'image', required: false, source: 'broker', agent_can_fill: false, needs_human_confirmation: true, section: 'images' },
  { key: 'image_order', mobile_bg_label: 'Подредба', our_db_key: 'image_order', field_type: 'text', required: false, source: 'broker', agent_can_fill: false, needs_human_confirmation: false, section: 'images' },
  { key: 'image_processing_status', mobile_bg_label: 'Статус на обработка', our_db_key: 'image_processing_status', field_type: 'select', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: false, section: 'images', options: ['Чакащи','В обработка','Готови','Грешка'] },
  { key: 'jpg_ready', mobile_bg_label: 'JPG готова за Mobile.bg', our_db_key: 'jpg_ready', field_type: 'checkbox', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: false, section: 'images' },
  { key: 'original_image_url', mobile_bg_label: 'Оригинален URL', our_db_key: 'original_image_url', field_type: 'text', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: false, section: 'images' },
  { key: 'local_image_path', mobile_bg_label: 'Локален/сървърен файл', our_db_key: 'local_image_path', field_type: 'text', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: false, section: 'images' },
  { key: 'real_car_photo_check', mobile_bg_label: 'Проверка „реална снимка на автомобил“', our_db_key: 'real_car_photo_check', field_type: 'checkbox', required: false, source: 'agent', agent_can_fill: true, needs_human_confirmation: true, section: 'images' },

  // === 6. Данни за публикуване ===
  { key: 'location', mobile_bg_label: 'Населено място/област', our_db_key: 'location', field_type: 'text', required: true, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'seller_name', mobile_bg_label: 'Име на продавача/фирмата', our_db_key: 'seller_name', field_type: 'text', required: true, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'broker', mobile_bg_label: 'Брокер', our_db_key: 'broker_name', field_type: 'text', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'phone', mobile_bg_label: 'Телефон', our_db_key: 'phone', field_type: 'text', required: true, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'phone2', mobile_bg_label: 'Втори телефон', our_db_key: 'phone2', field_type: 'text', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'email', mobile_bg_label: 'Email', our_db_key: 'email', field_type: 'text', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'mobile_bg_profile', mobile_bg_label: 'Профил в Mobile.bg', our_db_key: 'mobile_bg_profile', field_type: 'text', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'ad_type', mobile_bg_label: 'Тип обява/пакет', our_db_key: 'ad_type', field_type: 'select', required: true, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing', options: ['Стандартна','Премиум','VIP','Топ плюс','Платени галерии'] },
  { key: 'publish_date', mobile_bg_label: 'Дата на публикуване', our_db_key: 'publish_date', field_type: 'date', required: false, source: 'manual', agent_can_fill: true, needs_human_confirmation: false, section: 'publishing' },
  { key: 'mobile_bg_url', mobile_bg_label: 'Mobile.bg URL', our_db_key: 'mobile_bg_url', field_type: 'text', required: false, source: 'manual', agent_can_fill: false, needs_human_confirmation: false, section: 'publishing' },
  { key: 'mobile_bg_id', mobile_bg_label: 'Mobile.bg ID на обявата', our_db_key: 'mobile_bg_listing_id', field_type: 'text', required: false, source: 'manual', agent_can_fill: false, needs_human_confirmation: false, section: 'publishing' },

  // === 7. Данни за източника и контрол ===
  { key: 'source_type', mobile_bg_label: 'Източник', our_db_key: 'source_type', field_type: 'select', required: true, source: 'catalog', agent_can_fill: true, needs_human_confirmation: false, section: 'source_control', options: ['Encar','AutoTrader','Каталог'] },
  { key: 'source_url', mobile_bg_label: 'URL на източниковата обява', our_db_key: 'source_url', field_type: 'text', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: false, section: 'source_control' },
  { key: 'source_listing_id', mobile_bg_label: 'ID на източниковата обява', our_db_key: 'source_listing_id', field_type: 'text', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: false, section: 'source_control' },
  { key: 'source_vin', mobile_bg_label: 'VIN', our_db_key: 'source_vin', field_type: 'text', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: false, section: 'source_control' },
  { key: 'source_price', mobile_bg_label: 'Цена на източника', our_db_key: 'source_price_eur', field_type: 'number', required: false, source: 'encar', agent_can_fill: true, needs_human_confirmation: false, section: 'source_control' },
  { key: 'catalog_permanent_id', mobile_bg_label: 'Permanent ID от каталога', our_db_key: 'catalog_permanent_id', field_type: 'number', required: false, source: 'catalog', agent_can_fill: true, needs_human_confirmation: false, section: 'source_control' },
  { key: 'created_by', mobile_bg_label: 'Кой е създал черновата', our_db_key: 'created_by', field_type: 'text', required: false, source: 'manual', agent_can_fill: false, needs_human_confirmation: false, section: 'source_control' },
  { key: 'approved_by', mobile_bg_label: 'Кой е одобрил черновата', our_db_key: 'approved_by', field_type: 'text', required: false, source: 'manual', agent_can_fill: false, needs_human_confirmation: false, section: 'source_control' },
  { key: 'last_checked_at', mobile_bg_label: 'Дата на последна проверка', our_db_key: 'last_checked_at', field_type: 'date', required: false, source: 'manual', agent_can_fill: false, needs_human_confirmation: false, section: 'source_control' },
];

export const DRAFT_STATUSES = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'APPROVED',
  'PUBLISHING',
  'PUBLISHED',
  'ERROR',
  'SKIPPED',
] as const;

export type DraftStatus = typeof DRAFT_STATUSES[number];

export const DRAFT_STATUS_LABELS_BG: Record<string, string> = {
  DRAFT: 'Чернова',
  READY_FOR_REVIEW: 'Готова за проверка',
  APPROVED: 'Одобрена',
  PUBLISHING: 'Публикува се',
  PUBLISHED: 'Публикувана',
  ERROR: 'Грешка',
  SKIPPED: 'Пропусната',
};

export const DRAFT_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'slate',
  READY_FOR_REVIEW: 'amber',
  APPROVED: 'blue',
  PUBLISHING: 'blue',
  PUBLISHED: 'emerald',
  ERROR: 'rose',
  SKIPPED: 'slate',
};

export const EXTRA_GROUPS = ['Безопасност', 'Комфорт', 'Мултимедия', 'Защита', 'Други', 'Специализирани'];

export const SECTION_LABELS_BG: Record<string, string> = {
  basic: '1. Основни данни за автомобила',
  price: '2. Цена и условия',
  extras: '3. Екстри',
  description: '4. Описание',
  images: '5. Снимки',
  publishing: '6. Данни за публикуване',
  source_control: '7. Данни за източника и контрол',
};

export const SOURCE_LABELS_BG: Record<string, string> = {
  catalog: 'Каталог',
  encar: 'Encar',
  autotrader: 'AutoTrader',
  broker: 'Брокер',
  agent: 'Агент',
  manual: 'Ръчно',
};

export function fieldsBySection(section: FieldSection): MobileBgFieldDef[] {
  return MOBILE_BG_FIELD_MAP.filter(f => f.section === section);
}

export function extrasByGroup(group: string): MobileBgFieldDef[] {
  return MOBILE_BG_FIELD_MAP.filter(f => f.section === 'extras' && f.group === group);
}

export function requiredFields(): MobileBgFieldDef[] {
  return MOBILE_BG_FIELD_MAP.filter(f => f.required);
}
