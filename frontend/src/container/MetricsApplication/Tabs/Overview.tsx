import logEvent from 'api/common/logEvent';
import getTopLevelOperations, {
	ServiceDataProps,
} from 'api/metrics/getTopLevelOperations';
import { FeatureKeys } from 'constants/features';
import { QueryParams } from 'constants/query';
import { PANEL_TYPES } from 'constants/queryBuilder';
import ROUTES from 'constants/routes';
import { routeConfig } from 'container/SideNav/config';
import { getQueryString } from 'container/SideNav/helper';
import useFeatureFlag from 'hooks/useFeatureFlag';
import useResourceAttribute from 'hooks/useResourceAttribute';
import {
	convertRawQueriesToTraceSelectedTags,
	resourceAttributesToTagFilterItems,
} from 'hooks/useResourceAttribute/utils';
import useUrlQuery from 'hooks/useUrlQuery';
import history from 'lib/history';
import { OnClickPluginOpts } from 'lib/uPlotLib/plugins/onClickPlugin';
import { defaultTo } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from 'react-query';
import { useDispatch } from 'react-redux';
import { useLocation, useParams } from 'react-router-dom';
import { UpdateTimeInterval } from 'store/actions';
import { DataTypes } from 'types/api/queryBuilder/queryAutocompleteResponse';
import { Query } from 'types/api/queryBuilder/queryBuilderData';
import { EQueryType } from 'types/common/dashboard';
import { v4 as uuid } from 'uuid';

import { GraphTitle, SERVICE_CHART_ID } from '../constant';
import { getWidgetQueryBuilder } from '../MetricsApplication.factory';
import {
	errorPercentage,
	operationPerSec,
} from '../MetricsPageQueries/OverviewQueries';
import { Col, ColApDexContainer, ColErrorContainer, Row } from '../styles';
import ApDex from './Overview/ApDex';
import ServiceOverview from './Overview/ServiceOverview';
import TopLevelOperation from './Overview/TopLevelOperations';
import TopOperation from './Overview/TopOperation';
import TopOperationMetrics from './Overview/TopOperationMetrics';
import { Button, Card } from './styles';
import { IServiceName } from './types';
import {
	handleNonInQueryRange,
	onGraphClickHandler,
	onViewTracePopupClick,
	useGetAPMToTracesQueries,
} from './util';

function Application(): JSX.Element {
	const { servicename: encodedServiceName } = useParams<IServiceName>();
	const servicename = decodeURIComponent(encodedServiceName);
	const [selectedTimeStamp, setSelectedTimeStamp] = useState<number>(0);
	const { search, pathname } = useLocation();
	const { queries } = useResourceAttribute();
	const urlQuery = useUrlQuery();

	const isSpanMetricEnabled = useFeatureFlag(FeatureKeys.USE_SPAN_METRICS)
		?.active;

	const handleSetTimeStamp = useCallback((selectTime: number) => {
		setSelectedTimeStamp(selectTime);
	}, []);

	const dispatch = useDispatch();
	const handleGraphClick = useCallback(
		(type: string): OnClickPluginOpts['onClick'] => (
			xValue,
			yValue,
			mouseX,
			mouseY,
		): Promise<void> =>
			onGraphClickHandler(handleSetTimeStamp)(
				xValue,
				yValue,
				mouseX,
				mouseY,
				type,
			),
		[handleSetTimeStamp],
	);

	const logEventCalledRef = useRef(false);
	useEffect(() => {
		if (!logEventCalledRef.current) {
			const selectedEnvironments = queries.find(
				(val) => val.tagKey === 'resource_deployment_environment',
			)?.tagValue;

			logEvent('APM: Service detail page visited', {
				selectedEnvironments,
				resourceAttributeUsed: !!queries.length,
				section: 'overview',
			});
			logEventCalledRef.current = true;
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const {
		data: topLevelOperations,
		error: topLevelOperationsError,
		isLoading: topLevelOperationsIsLoading,
		isError: topLevelOperationsIsError,
	} = useQuery<ServiceDataProps>({
		queryKey: [servicename],
		queryFn: getTopLevelOperations,
	});

	const selectedTraceTags: string = JSON.stringify(
		convertRawQueriesToTraceSelectedTags(queries) || [],
	);

	const apmToTraceQuery = useGetAPMToTracesQueries({ servicename });

	const tagFilterItems = useMemo(
		() =>
			handleNonInQueryRange(resourceAttributesToTagFilterItems(queries)) || [],
		[queries],
	);

	const topLevelOperationsRoute = useMemo(
		() =>
			topLevelOperations
				? defaultTo(topLevelOperations[servicename || ''], [])
				: [],
		[servicename, topLevelOperations],
	);

	const operationPerSecWidget = getWidgetQueryBuilder({
		query: {
			queryType: EQueryType.QUERY_BUILDER,
			promql: [],
			builder: operationPerSec({
				servicename,
				tagFilterItems,
				topLevelOperations: topLevelOperationsRoute,
			}),
			clickhouse_sql: [],
			id: uuid(),
		},
		title: GraphTitle.RATE_PER_OPS,
		panelTypes: PANEL_TYPES.TIME_SERIES,
		yAxisUnit: 'ops',
		id: SERVICE_CHART_ID.rps,
	});

	const errorPercentageWidget = getWidgetQueryBuilder({
		query: {
			queryType: EQueryType.QUERY_BUILDER,
			promql: [],
			builder: errorPercentage({
				servicename,
				tagFilterItems,
				topLevelOperations: topLevelOperationsRoute,
			}),
			clickhouse_sql: [],
			id: uuid(),
		},
		title: GraphTitle.ERROR_PERCENTAGE,
		panelTypes: PANEL_TYPES.TIME_SERIES,
		yAxisUnit: '%',
		id: SERVICE_CHART_ID.errorPercentage,
	});

	const onDragSelect = useCallback(
		(start: number, end: number) => {
			const startTimestamp = Math.trunc(start);
			const endTimestamp = Math.trunc(end);

			urlQuery.set(QueryParams.startTime, startTimestamp.toString());
			urlQuery.set(QueryParams.endTime, endTimestamp.toString());
			const generatedUrl = `${pathname}?${urlQuery.toString()}`;
			history.replace(generatedUrl);

			if (startTimestamp !== endTimestamp) {
				dispatch(UpdateTimeInterval('custom', [startTimestamp, endTimestamp]));
			}
		},
		[dispatch, pathname, urlQuery],
	);

	const onErrorTrackHandler = (
		timestamp: number,
		apmToTraceQuery: Query,
	): (() => void) => (): void => {
		const currentTime = timestamp;
		const tPlusOne = timestamp + 60 * 1000;

		const urlParams = new URLSearchParams(search);
		urlParams.set(QueryParams.startTime, currentTime.toString());
		urlParams.set(QueryParams.endTime, tPlusOne.toString());

		const avialableParams = routeConfig[ROUTES.TRACE];
		const queryString = getQueryString(avialableParams, urlParams);

		const JSONCompositeQuery = encodeURIComponent(
			JSON.stringify(apmToTraceQuery),
		);

		const newTraceExplorerPath = `${
			ROUTES.TRACES_EXPLORER
		}?${urlParams.toString()}&selected={"serviceName":["${servicename}"]}&filterToFetchData=["duration","status","serviceName"]&spanAggregateCurrentPage=1&selectedTags=${selectedTraceTags}&${
			QueryParams.compositeQuery
		}=${JSONCompositeQuery}&${queryString.join('&')}`;

		history.push(newTraceExplorerPath);
	};

	const errorTrackQuery = useGetAPMToTracesQueries({
		servicename,
		filters: [
			{
				id: uuid().slice(0, 8),
				key: {
					key: 'hasError',
					dataType: DataTypes.bool,
					type: 'tag',
					isColumn: true,
					isJSON: false,
					id: 'hasError--bool--tag--true',
				},
				op: 'in',
				value: ['true'],
			},
		],
	});

	return (
		<>
			<Row gutter={24}>
				<Col span={12}>
					<ServiceOverview
						onDragSelect={onDragSelect}
						handleGraphClick={handleGraphClick}
						selectedTimeStamp={selectedTimeStamp}
						selectedTraceTags={selectedTraceTags}
						topLevelOperationsRoute={topLevelOperationsRoute}
						topLevelOperationsIsLoading={topLevelOperationsIsLoading}
					/>
				</Col>

				<Col span={12}>
					<Button
						type="default"
						size="small"
						id="Rate_button"
						onClick={onViewTracePopupClick({
							servicename,
							selectedTraceTags,
							timestamp: selectedTimeStamp,
							apmToTraceQuery,
						})}
					>
						View Traces
					</Button>
					<TopLevelOperation
						handleGraphClick={handleGraphClick}
						onDragSelect={onDragSelect}
						topLevelOperationsError={topLevelOperationsError}
						topLevelOperationsIsError={topLevelOperationsIsError}
						name="operations_per_sec"
						widget={operationPerSecWidget}
						opName="Rate"
						topLevelOperationsIsLoading={topLevelOperationsIsLoading}
					/>
				</Col>
			</Row>
			<Row gutter={24}>
				<Col span={12}>
					<ColApDexContainer>
						<Button
							type="default"
							size="small"
							id="ApDex_button"
							onClick={onViewTracePopupClick({
								servicename,
								selectedTraceTags,
								timestamp: selectedTimeStamp,
								apmToTraceQuery,
							})}
						>
							View Traces
						</Button>
						<ApDex
							handleGraphClick={handleGraphClick}
							onDragSelect={onDragSelect}
							topLevelOperationsRoute={topLevelOperationsRoute}
							tagFilterItems={tagFilterItems}
						/>
					</ColApDexContainer>
					<ColErrorContainer>
						<Button
							type="default"
							size="small"
							id="Error_button"
							onClick={onErrorTrackHandler(selectedTimeStamp, errorTrackQuery)}
						>
							View Traces
						</Button>

						<TopLevelOperation
							handleGraphClick={handleGraphClick}
							onDragSelect={onDragSelect}
							topLevelOperationsError={topLevelOperationsError}
							topLevelOperationsIsError={topLevelOperationsIsError}
							name="error_percentage_%"
							widget={errorPercentageWidget}
							opName="Error"
							topLevelOperationsIsLoading={topLevelOperationsIsLoading}
						/>
					</ColErrorContainer>
				</Col>

				<Col span={12}>
					<Card>
						{isSpanMetricEnabled ? <TopOperationMetrics /> : <TopOperation />}{' '}
					</Card>
				</Col>
			</Row>
		</>
	);
}

export type ClickHandlerType = () => void;

export default Application;
