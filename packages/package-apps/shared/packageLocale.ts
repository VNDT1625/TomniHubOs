import enUS from '@arco-design/web-react/es/locale/en-US';
import jaJP from '@arco-design/web-react/es/locale/ja-JP';
import koKR from '@arco-design/web-react/es/locale/ko-KR';
import ruRU from '@arco-design/web-react/es/locale/ru-RU';
import trTR from '@arco-design/web-react/es/locale/tr-TR';
import viVN from '@arco-design/web-react/es/locale/vi-VN';
import zhCN from '@arco-design/web-react/es/locale/zh-CN';
import zhTW from '@arco-design/web-react/es/locale/zh-TW';

type CompleteArcoLocale = typeof enUS;
type PartialArcoCalendar = Omit<CompleteArcoLocale['Calendar'], 'monthFormat' | 'yearFormat'> &
  Partial<Pick<CompleteArcoLocale['Calendar'], 'monthFormat' | 'yearFormat'>>;
type PartialArcoLocale = Omit<CompleteArcoLocale, 'Calendar' | 'DatePicker' | 'Form' | 'ColorPicker'> & {
  Calendar: PartialArcoCalendar;
  DatePicker: Omit<CompleteArcoLocale['DatePicker'], 'Calendar'> & { Calendar: PartialArcoCalendar };
  Form?: CompleteArcoLocale['Form'];
  ColorPicker?: CompleteArcoLocale['ColorPicker'];
};

const completeArcoLocale = (locale: PartialArcoLocale): CompleteArcoLocale => ({
  ...locale,
  Calendar: {
    ...locale.Calendar,
    monthFormat: locale.Calendar.monthFormat ?? enUS.Calendar.monthFormat,
    yearFormat: locale.Calendar.yearFormat ?? enUS.Calendar.yearFormat,
  },
  DatePicker: {
    ...locale.DatePicker,
    Calendar: {
      ...locale.DatePicker.Calendar,
      monthFormat: locale.DatePicker.Calendar.monthFormat ?? enUS.DatePicker.Calendar.monthFormat,
      yearFormat: locale.DatePicker.Calendar.yearFormat ?? enUS.DatePicker.Calendar.yearFormat,
    },
  },
  Form: locale.Form ?? enUS.Form,
  ColorPicker: locale.ColorPicker ?? enUS.ColorPicker,
});

const PACKAGE_ARCO_LOCALES: Readonly<Record<string, CompleteArcoLocale>> = {
  'en-US': enUS,
  'ja-JP': completeArcoLocale(jaJP),
  'ko-KR': completeArcoLocale(koKR),
  'ru-RU': completeArcoLocale(ruRU),
  'tr-TR': completeArcoLocale(trTR),
  'vi-VN': completeArcoLocale(viVN),
  'zh-CN': completeArcoLocale(zhCN),
  'zh-TW': completeArcoLocale(zhTW),
};

export const resolvePackageArcoLocale = (language: string): CompleteArcoLocale =>
  PACKAGE_ARCO_LOCALES[language] ?? enUS;
