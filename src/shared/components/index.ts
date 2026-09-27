/**
 * Shared component barrel.
 *
 * These components carry the design system's markup and class names. Feature
 * modules compose them and must not re-declare the same styling locally.
 */
export { Icon, type IconProps } from './Icon';
export { IconSprite, type IconName } from './IconSprite';
export { Chip, type ChipProps } from './Chip';
export { Card, CardHeader, CardBody } from './Card';
export { Kpi, KpiGrid, Delta, type DeltaDirection } from './Kpi';
export { Button, type ButtonVariant } from './Button';
export { Stack, Row, Grid, Toolbar, SectionHeading, Sub, Stat } from './Layout';
export { DataTable, CellMain, CellSub, Num, type DataTableColumn } from './DataTable';
export { FilterGroup, type FilterOption } from './FilterGroup';
export { Banner } from './Banner';
export { Timeline, type TimelineEntry, type TimelineState } from './Timeline';
export { Stepper, type StepperStep } from './Stepper';
export { Confidence } from './Confidence';
export { Avatar, OwnerTag, initialsOf } from './Avatar';
export { List, ListRow, DateBox } from './ListRow';
export { Tabs } from './Tabs';
export { TextField, SelectField, FieldGrid } from './Field';
export { Modal, type ModalProps } from './Modal';
export { FinanceGrid, type FinanceGridColumn, type FinanceGridRow, type FinanceGridCell } from './FinanceGrid';
export { FinanceLegend, type FinanceLegendItem } from './FinanceLegend';
